import {
  AI_TASK_GENERATE_MESSAGE,
  AI_TASK_SELECT_NEXT_QUESTION,
  aiMessagePromptSchema,
  aiPromptSchema,
  type AiConceptRef,
  type AiMessagePrompt,
  type AiPrompt,
  type AiUserContextItem,
} from './provider.js';

/**
 * Samenstellen van de **beperkte, verse context** per AI-aanroep (T5.1, DESIGN §7.7, §7.8).
 *
 * Dit is de enige plek die een `AiPrompt` vormt. Elke aanroep krijgt uitsluitend:
 * `systeemregels + doel + AAC-regels + gebruikerscontext + gesprekscontext + laatste keuze +
 * toegestane opties`. Er is **geen** veld voor chatgeschiedenis of vrije invoer — de sleutelset is
 * gesloten (afgedwongen door `aiPromptSchema`), zodat aantoonbaar alléén toegestane context de provider
 * bereikt. De gesprekscontext zijn puur de gekozen AAC-concepten (geen tekstlog), en de opties zijn
 * AAC-begrensd (DESIGN §7.6).
 */

/**
 * Harde systeem-/veiligheidsregels (DESIGN §7.8). Deze reizen bij élke aanroep mee en begrenzen wat het
 * model mag: nooit een boodschap verzinnen, geen persoonlijke info toevoegen zonder toestemming, nooit
 * namens de gebruiker spreken, en binnen de aangeboden AAC-concepten blijven. Bewust een vaste lijst.
 */
export const SYSTEM_RULES: readonly string[] = [
  'Je bent een hulpmiddel dat de gebruiker helpt zijn eigen intentie te vinden; je bent geen chatbot.',
  'Je verzint nooit een boodschap zonder basis in de keuzes van de gebruiker.',
  'Je voegt nooit persoonlijke informatie toe die niet expliciet in de context staat.',
  'Je spreekt nooit namens de gebruiker; de gebruiker blijft eigenaar van de boodschap.',
  'Je kiest uitsluitend uit de aangeboden AAC-concepten; je verzint geen nieuwe concepten.',
  'Je krijgt per beurt verse, beperkte context — geen chatgeschiedenis; baseer je alleen hierop.',
];

/** Het doel van Intento zoals het model het per aanroep meekrijgt (DESIGN §1, §7.1). */
export const GOAL =
  'Bepaal de meest waardevolle volgende pictogramvraag: verminder onzekerheid, overlaad de ' +
  'gebruiker niet, en kies de snelste route naar de bedoelde betekenis.';

/** AAC-begrenzingsregels (DESIGN §7.6). */
export const AAC_RULES: readonly string[] = [
  'Elk voorgesteld symbool moet een bestaand concept uit de aangeboden opties zijn.',
  'Bied geen concepten aan buiten de meegegeven "availableSymbols".',
  'Herhaal geen vraag of optie die al eerder in de gesprekscontext is gekozen.',
];

/** Het doel bij boodschapgeneratie (T5.3, DESIGN §7.1 taak 4, §7.8). */
export const MESSAGE_GOAL =
  'Vorm uit de bevestigde concepten één korte, natuurlijke Nederlandse zin die de gebruiker zelf in de ' +
  'ik-vorm zou zeggen. Blijf strikt binnen de gekozen concepten: voeg geen nieuwe onderwerpen, personen, ' +
  'plekken of activiteiten toe die niet in "chosenConcepts" staan.';

/** AAC-begrenzingsregels specifiek voor de boodschapgeneratie (DESIGN §7.6, §7.8). */
export const MESSAGE_AAC_RULES: readonly string[] = [
  'Gebruik uitsluitend de concepten uit "chosenConcepts"; verzin geen extra begrippen.',
  'Voeg geen persoonlijke informatie toe die niet in de context staat.',
  'Formuleer één enkele zin — geen vraag, geen opsomming, geen toelichting.',
];

/** Invoer voor de promptbouw: de reeds gezette route, de toegestane opties en (later) gebruikerscontext. */
export interface AiPromptInput {
  /** De tot nu toe gekozen concepten (oplopend op volgorde). Leeg = startvraag. */
  conversationContext: AiConceptRef[];
  /** De op dit moment toegestane opties (AAC-begrensd), reeds geladen door de aanroeper. */
  availableSymbols: AiConceptRef[];
  /**
   * Toegestane gebruikerscontext (DESIGN §7.7). Optioneel en in deze fase doorgaans leeg; T6.1 vult
   * dit met **alleen** de context waarvoor toestemming (`aiUsageAllowed=true`) is gegeven.
   */
  userContext?: AiUserContextItem[];
}

/**
 * Vormt de beperkte context tot een gevalideerde `AiPrompt`. De laatste keuze wordt afgeleid uit de
 * gesprekscontext (de laatst gekozen concept), zodat er nooit een losse, afwijkende "laatste keuze"
 * ingeslopen kan zijn. Het resultaat wordt door `aiPromptSchema` geparseerd: de gesloten sleutelset is
 * daarmee gegarandeerd (T5.1-acceptatie: alléén toegestane context).
 */
export function buildAiPrompt(input: AiPromptInput): AiPrompt {
  const conversationContext = input.conversationContext;
  const lastChoice =
    conversationContext.length > 0 ? conversationContext[conversationContext.length - 1]! : null;
  return aiPromptSchema.parse({
    task: AI_TASK_SELECT_NEXT_QUESTION,
    systemRules: [...SYSTEM_RULES],
    goal: GOAL,
    aacRules: [...AAC_RULES],
    userContext: input.userContext ?? [],
    conversationContext,
    lastChoice,
    availableSymbols: input.availableSymbols,
  });
}

/**
 * Serialiseert de prompt naar een compacte, deterministische tekst voor een echte LLM-provider. Bewust
 * alléén de velden uit `AiPrompt` (de gesloten set) — er kan hier geen extra context inlekken. De mock
 * gebruikt deze functie niet (die leest het gestructureerde object rechtstreeks); ze bestaat zodat een
 * latere tekst-gebaseerde provider dezelfde begrensde context krijgt.
 */
export function renderPromptText(prompt: AiPrompt): string {
  const lines: string[] = [];
  lines.push(`TAAK: ${prompt.task}`);
  lines.push('', 'SYSTEEMREGELS:');
  for (const rule of prompt.systemRules) lines.push(`- ${rule}`);
  lines.push('', `DOEL: ${prompt.goal}`);
  lines.push('', 'AAC-REGELS:');
  for (const rule of prompt.aacRules) lines.push(`- ${rule}`);
  lines.push('', 'GEBRUIKERSCONTEXT:');
  for (const item of prompt.userContext) lines.push(`- ${item.kind}: ${item.value}`);
  lines.push('', 'GESPREKSCONTEXT (gekozen concepten):');
  for (const ref of prompt.conversationContext) lines.push(`- ${ref.concept} (${ref.label})`);
  lines.push('', `LAATSTE KEUZE: ${prompt.lastChoice ? prompt.lastChoice.concept : '(geen)'}`);
  lines.push('', 'TOEGESTANE OPTIES:');
  for (const ref of prompt.availableSymbols) lines.push(`- ${ref.concept} (${ref.label})`);
  return lines.join('\n');
}

/** Invoer voor de boodschap-prompt: de bevestigde concepten en (later) toegestane gebruikerscontext. */
export interface AiMessagePromptInput {
  /** De bevestigde concepten (oplopend op volgorde; de eerste is de intentie). */
  chosenConcepts: AiConceptRef[];
  /**
   * Toegestane gebruikerscontext (DESIGN §7.7). Optioneel en in deze fase doorgaans leeg; T6.1 vult
   * dit met **alleen** de context waarvoor toestemming (`aiUsageAllowed=true`) is gegeven.
   */
  userContext?: AiUserContextItem[];
}

/**
 * Vormt de beperkte context voor boodschapgeneratie tot een gevalideerde `AiMessagePrompt` (T5.3).
 * Net als `buildAiPrompt` is dit de enige plek die dit object vormt: de gesloten sleutelset (afgedwongen
 * door `aiMessagePromptSchema`) garandeert dat er geen chatgeschiedenis of vrije invoer inlekt.
 */
export function buildMessagePrompt(input: AiMessagePromptInput): AiMessagePrompt {
  return aiMessagePromptSchema.parse({
    task: AI_TASK_GENERATE_MESSAGE,
    systemRules: [...SYSTEM_RULES],
    goal: MESSAGE_GOAL,
    aacRules: [...MESSAGE_AAC_RULES],
    userContext: input.userContext ?? [],
    chosenConcepts: input.chosenConcepts,
  });
}

/**
 * Serialiseert de boodschap-prompt naar compacte, deterministische tekst voor een echte LLM-provider —
 * uitsluitend de velden uit `AiMessagePrompt` (de gesloten set), zodat er geen extra context inlekt. De
 * mock gebruikt dit niet; het bestaat zodat een latere tekst-gebaseerde provider dezelfde begrensde
 * context krijgt (symmetrisch met `renderPromptText`).
 */
export function renderMessagePromptText(prompt: AiMessagePrompt): string {
  const lines: string[] = [];
  lines.push(`TAAK: ${prompt.task}`);
  lines.push('', 'SYSTEEMREGELS:');
  for (const rule of prompt.systemRules) lines.push(`- ${rule}`);
  lines.push('', `DOEL: ${prompt.goal}`);
  lines.push('', 'AAC-REGELS:');
  for (const rule of prompt.aacRules) lines.push(`- ${rule}`);
  lines.push('', 'GEBRUIKERSCONTEXT:');
  for (const item of prompt.userContext) lines.push(`- ${item.kind}: ${item.value}`);
  lines.push('', 'BEVESTIGDE CONCEPTEN (in volgorde):');
  for (const ref of prompt.chosenConcepts) lines.push(`- ${ref.concept} (${ref.label})`);
  return lines.join('\n');
}
