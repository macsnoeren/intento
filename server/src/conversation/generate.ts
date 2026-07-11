import type { PrismaClient } from '../generated/prisma/client.js';
import type { AiOrchestrator } from '../ai/orchestrator.js';
import type { AiUserContextItem } from '../ai/provider.js';
import { DEFAULT_MESSAGE_CONFIDENCE } from '../ai/thresholds.js';
import { normalizeSearch } from '../aac/library.js';
import { generateMessage, SCRIPTED_CONFIDENCE, type ChosenConcept } from './message.js';

/**
 * AI-boodschapgeneratie met veiligheidsvangnet (T5.3, DESIGN §3.1, §7.1 taak 4, §7.4, §7.8, FR-007/008).
 *
 * Dit is de conversatie-laag rond de Message Generator: waar `decideNextQuestion` (decision.ts) de
 * volgende vraag door de orchestrator laat kiezen, laat `composeMessage` de orchestrator de **zin**
 * formuleren — met dezelfde harde waarborg dat een provider (en straks een externe worker) nooit buiten
 * de AAC-begrenzing kan treden:
 *
 *  1. **Sjabloon als veilige bodem.** De deterministische `generateMessage(chosen)` (message.ts) vormt
 *     altijd een zin die per constructie **binnen de gekozen concepten** blijft (§7.8). Die is de
 *     terugval wanneer de provider geen zin kan leveren of een onveilige zin teruggeeft.
 *  2. **AI formuleert (optioneel).** Kan de provider het (`orchestrator.canGenerateMessage`), dan vraagt
 *     de orchestrator een zin met verse, beperkte context (buildMessagePrompt) en valideert de **vorm**.
 *  3. **Safety-controle (§7.8).** De AI-zin mag **geen concept bevatten dat niet in de sessie is gekozen**.
 *     `messageIntroducesForeignConcept` scant de zin tegen de hele AAC-bibliotheek: duikt het label of een
 *     synoniem van een níet-gekozen symbool op, dan is de zin onveilig en valt hij terug op de sjabloon.
 *     Zo bereikt een verzonnen/buiten-de-sessie begrip de gebruiker **nooit** — ook niet bij een
 *     onbetrouwbare provider.
 *
 * De laag is bewust vrij van HTTP: de route levert de gekozen concepten aan en gebruikt het resultaat,
 * zodat alles deterministisch met de mock (of een test-provider) te testen is.
 */

/** Uitkomst van de generatie: de zin, de zekerheid (§7.4) en of hij van de AI of het sjabloon komt. */
export interface ComposedMessage {
  message: string;
  confidence: number;
  /** `ai` = door de provider geformuleerd en veilig bevonden; `scripted` = deterministische terugval. */
  source: 'ai' | 'scripted';
}

/**
 * Splitst tekst in genormaliseerde woorden (lowercase, niet-letters worden scheidingstekens) en levert
 * een met spaties omrande string terug, zodat een hele-woord-/frase-match met `includes(' term ')` werkt
 * (ook voor meerwoordige labels als "met hond"). Unicode-letterklasse zodat accenten meetellen.
 */
function normalizedHaystack(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return ` ${cleaned} `;
}

/**
 * Bepaalt of een geformuleerde zin een concept bevat dat **niet** in de sessie is gekozen (§7.8). Loopt
 * de AAC-bibliotheek langs; voor elk symbool waarvan het concept niet gekozen is, checkt het of het label
 * of een synoniem als heel woord/frase in de zin voorkomt. Bewust conservatief (fail-safe): een twijfel-
 * geval leidt tot de veilige sjabloon-terugval, niet tot een mogelijk buiten-de-sessie begrip.
 */
async function messageIntroducesForeignConcept(
  prisma: PrismaClient,
  message: string,
  chosenConcepts: Set<string>,
): Promise<boolean> {
  const haystack = normalizedHaystack(message);
  if (haystack.trim().length === 0) return false;

  const symbols = await prisma.aacSymbol.findMany({
    select: { concept: true, label: true, synonyms: true },
  });
  for (const symbol of symbols) {
    if (chosenConcepts.has(symbol.concept)) continue;
    const synonyms = Array.isArray(symbol.synonyms) ? symbol.synonyms : [];
    const terms = [symbol.label, ...synonyms.filter((s): s is string => typeof s === 'string')];
    for (const term of terms) {
      const needle = normalizeSearch(term).replace(/\s+/g, ' ').trim();
      if (needle.length === 0) continue;
      if (haystack.includes(` ${needle} `)) return true;
    }
  }
  return false;
}

/**
 * Vormt de voor te stellen boodschap uit de gekozen concepten. Probeert eerst de AI-orchestrator; valt
 * terug op de deterministische sjabloon-zin wanneer de provider het niet kan, een lege zin levert, of een
 * zin met een concept buiten de sessie (§7.8). De gekozen concepten mogen niet leeg zijn (de route
 * weigert dat met een 400).
 */
export async function composeMessage(
  prisma: PrismaClient,
  orchestrator: AiOrchestrator,
  chosen: ChosenConcept[],
  userContext: AiUserContextItem[] = [],
): Promise<ComposedMessage> {
  // Veilige bodem: altijd beschikbaar, altijd binnen de gekozen concepten.
  const scripted = generateMessage(chosen);
  const scriptedResult: ComposedMessage = {
    message: scripted,
    confidence: SCRIPTED_CONFIDENCE,
    source: 'scripted',
  };

  if (!orchestrator.canGenerateMessage) return scriptedResult;

  const aiResult = await orchestrator.generateMessage({
    chosenConcepts: chosen.map((c) => ({ concept: c.concept, label: c.label })),
    userContext,
  });
  if (!aiResult) return scriptedResult;

  const message = aiResult.message.trim();
  if (message.length === 0) return scriptedResult;

  const chosenSet = new Set(chosen.map((c) => c.concept));
  if (await messageIntroducesForeignConcept(prisma, message, chosenSet)) {
    return scriptedResult;
  }

  return {
    message,
    confidence: aiResult.confidence ?? DEFAULT_MESSAGE_CONFIDENCE,
    source: 'ai',
  };
}
