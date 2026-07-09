import type { AacSymbol as AacSymbolPublic, ConversationQuestion } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AacSymbolModel, ConversationStepModel } from '../generated/prisma/models.js';
import { symbolToPublic } from '../aac/library.js';

/**
 * Gescripte gespreks-engine (T4.1, DESIGN §3.1, §7.x achter dezelfde interface).
 *
 * De engine bepaalt bij elke stap de volgende vraag + pictogramopties puur uit de **AAC-relatieboom**:
 * de startvraag toont de intentie-categorieën (`category === 'intent'`), en elke volgende vraag toont de
 * kinderen (`AacConceptRelation`) van het laatst gekozen concept. Zo is de "huidige vraag" een pure
 * functie van de reeds gezette stappen — waardoor de terug-functie de vorige opties **exact** herstelt.
 *
 * Deze module is bewust de enige plek waar de scripted vraagselectie leeft, achter een smalle interface
 * (`currentQuestion`, `resolveOption`). De AI-orchestrator (fase 5) vervangt de logica hierbinnen zonder
 * dat de route-laag verandert. De engine kiest géén subset op `iconsPerScreen` en doet géén AI-selectie:
 * ze levert de volledige kindset; het beperken/kiezen is een UI- (T4.2) resp. AI-taak (T5.2).
 */

/** De prompttekst van het startscherm: de vraag naar de intentie (DESIGN §3.1). */
export const ROOT_PROMPT = 'Wat wil je duidelijk maken?';

/**
 * Prompttekst per bovenliggend concept. Houdt de gescripte vragen natuurlijk en aansluitend op de
 * voorbeeldflows uit DESIGN §3 (bv. "Wat wil je buiten doen?", "Wat wil je drinken?"). Onbekende
 * concepten vallen terug op een generieke prompt met het label.
 */
const PROMPT_BY_CONCEPT: Record<string, string> = {
  say: 'Wat wil je zeggen?',
  feel: 'Hoe voel je je?',
  problem: 'Wat is er aan de hand?',
  ask: 'Wat wil je vragen?',
  want: 'Wat wil je?',
  'do-activity': 'Wat wil je doen?',
  outside: 'Wat wil je buiten doen?',
  walking: 'Met wie of wat wil je wandelen?',
  eat: 'Wat wil je eten?',
  drink: 'Wat wil je drinken?',
  pain: 'Waar heb je pijn?',
};

/** Bouwt de prompttekst bij een bovenliggend concept (of de generieke fallback met het label). */
function promptFor(concept: string, label: string): string {
  return PROMPT_BY_CONCEPT[concept] ?? `Kies bij "${label}":`;
}

/** Haalt de intentie-symbolen op (startscherm-categorieën), gesorteerd voor een stabiele volgorde. */
async function loadIntentSymbols(prisma: PrismaClient): Promise<AacSymbolModel[]> {
  return prisma.aacSymbol.findMany({ where: { category: 'intent' }, orderBy: { label: 'asc' } });
}

/**
 * Haalt de kinderen (verfijningen) van een concept op via `AacConceptRelation`, gesorteerd op label.
 * Geeft een lege lijst als het concept onbekend is of geen kinderen heeft (= eindconcept).
 */
async function loadChildSymbols(prisma: PrismaClient, concept: string): Promise<AacSymbolModel[]> {
  const parent = await prisma.aacSymbol.findUnique({ where: { concept } });
  if (!parent) return [];
  const relations = await prisma.aacConceptRelation.findMany({
    where: { parentId: parent.id },
    include: { child: true },
    orderBy: { child: { label: 'asc' } },
  });
  return relations.map((relation) => relation.child);
}

/** Zet symbolen om naar een `ConversationQuestion` met de gegeven prompt. */
function toQuestion(prompt: string, symbols: AacSymbolModel[]): ConversationQuestion {
  return { prompt, options: symbols.map(symbolToPublic) };
}

/**
 * De **huidige vraag** van een sessie, puur afgeleid uit de reeds gezette stappen:
 * - geen stappen → de startvraag (intentie-categorieën);
 * - anders → de kinderen van het laatst gekozen concept, of `null` als dat een eindconcept is
 *   (geen verdere verfijning; klaar om een boodschap voor te stellen — T4.3).
 *
 * `steps` moet op `order` oplopend gesorteerd zijn.
 */
export async function currentQuestion(
  prisma: PrismaClient,
  steps: Pick<ConversationStepModel, 'selectedConcept'>[],
): Promise<ConversationQuestion | null> {
  if (steps.length === 0) {
    return toQuestion(ROOT_PROMPT, await loadIntentSymbols(prisma));
  }
  const last = steps[steps.length - 1]!;
  const children = await loadChildSymbols(prisma, last.selectedConcept);
  if (children.length === 0) return null;
  const parent = await prisma.aacSymbol.findUnique({ where: { concept: last.selectedConcept } });
  return toQuestion(promptFor(last.selectedConcept, parent?.label ?? last.selectedConcept), children);
}

export interface ResolvedOption {
  /** Het gekozen symbool (uit de huidige opties). */
  symbol: AacSymbolPublic;
  /** De prompttekst van de vraag waarop dit een antwoord is (wordt op de stap vastgelegd). */
  question: string;
}

/**
 * Valideert dat `symbolId` één van de op dit moment aangeboden opties is en geeft het gekozen symbool
 * + de bijbehorende vraag terug. `null` betekent: geen geldige keuze (onbekend id, of niet in de
 * huidige opties, of het gesprek is al bij een eindconcept). Zo kan een gesprek nooit buiten de
 * aangeboden AAC-route springen (DESIGN §7.6, de bibliotheek begrenst de keuzes).
 */
export async function resolveOption(
  prisma: PrismaClient,
  steps: Pick<ConversationStepModel, 'selectedConcept'>[],
  symbolId: string,
): Promise<ResolvedOption | null> {
  const question = await currentQuestion(prisma, steps);
  if (!question) return null;
  const symbol = question.options.find((option) => option.id === symbolId);
  if (!symbol) return null;
  return { symbol, question: question.prompt };
}

/**
 * Serialiseert de historie: koppelt bij elke stap het (nog bestaande) symbool zodat de UI de gekozen
 * route (broodkruimel) kan tonen. Een stap waarvan het symbool intussen verwijderd is, valt weg —
 * de historie blijft leesbaar via de resterende stappen. `steps` moet op `order` oplopend staan.
 */
export function serializeHistory(
  steps: Pick<ConversationStepModel, 'order' | 'question' | 'selectedSymbolId'>[],
  symbolsById: Map<string, AacSymbolModel>,
): { order: number; question: string; symbol: AacSymbolPublic }[] {
  const history: { order: number; question: string; symbol: AacSymbolPublic }[] = [];
  for (const step of steps) {
    const model = step.selectedSymbolId ? symbolsById.get(step.selectedSymbolId) : undefined;
    if (!model) continue;
    history.push({ order: step.order, question: step.question, symbol: symbolToPublic(model) });
  }
  return history;
}
