import type { AacSymbol as AacSymbolPublic } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AacSymbolModel, ConversationStepModel } from '../generated/prisma/models.js';
import { symbolToPublic } from '../aac/library.js';

/**
 * AAC-boomtoegang voor de gespreksflow (T4.1, herzien in Fase 10).
 *
 * Deze module was oorspronkelijk de **gescripte gespreks-engine**: ze bepaalde de huidige vraag en
 * valideerde de keuze puur uit de AAC-relatieboom. Sinds Fase 10 komt de vraag uit de AI-beslissingslaag
 * (`decision.ts`) met kandidaten uit `candidates.ts`, en wordt een keuze gevalideerd tegen het
 * **vastgelegde aanbod** (`offer.ts`) in plaats van tegen de boom — anders zou elke AI-keuze buiten de
 * boom als `INVALID_CHOICE` geweigerd worden (zie ADR-0012).
 *
 * Wat hier overblijft, zijn de smalle **boomtoegangen** die de rest van de flow nog gebruikt: de
 * intentiecategorieën van het startscherm, de kinderen van een concept (de sterkste kandidatenbron én de
 * "is dit een eindconcept?"-check), en het serialiseren van de historie.
 */

/** De prompttekst van het startscherm: de vraag naar de intentie (DESIGN §3.1). */
export const ROOT_PROMPT = 'Wat wil je duidelijk maken?';

/** Haalt de intentie-symbolen op (startscherm-categorieën), gesorteerd voor een stabiele volgorde. */
export async function loadIntentSymbols(prisma: PrismaClient): Promise<AacSymbolModel[]> {
  return prisma.aacSymbol.findMany({ where: { category: 'intent' }, orderBy: { label: 'asc' } });
}

/**
 * Haalt de kinderen (verfijningen) van een concept op via `AacConceptRelation`, gesorteerd op label.
 * Geeft een lege lijst als het concept onbekend is of geen kinderen heeft (= eindconcept). Dit is de
 * sterkste kandidatenbron van `candidates.ts` (DESIGN §7.3) én de "is dit een eindconcept?"-check van
 * de beslissingslaag: geen kinderen betekent dat de route af is en er een boodschap voorgesteld mag
 * worden (§7.4). Sinds Fase 10 is dit een **signaal**, niet de grens van wat de AI mag voorstellen.
 */
export async function loadChildSymbols(
  prisma: PrismaClient,
  concept: string,
): Promise<AacSymbolModel[]> {
  const parent = await prisma.aacSymbol.findUnique({ where: { concept } });
  if (!parent) return [];
  const relations = await prisma.aacConceptRelation.findMany({
    where: { parentId: parent.id },
    include: { child: true },
    orderBy: { child: { label: 'asc' } },
  });
  return relations.map((relation) => relation.child);
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
