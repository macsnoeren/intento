/**
 * Confidence-drempels en fase-bepaling (T5.2, DESIGN §7.4).
 *
 * Het confidence-model uit DESIGN §7.4 vertaalt de interpretatie-zekerheid van de AI naar één van drie
 * acties:
 *
 * | Zekerheid | Fase       | Actie                                   |
 * |-----------|------------|-----------------------------------------|
 * | < 60%     | `select`   | Nieuwe pictogramvraag stellen           |
 * | 60–85%    | `refine`   | Verder verfijnen                        |
 * | > 85%     | `propose`  | Boodschap voorstellen (JA/NEE)          |
 *
 * De drempels leven op één plek zodat de beslissingslaag (decision.ts) en latere taken (T5.3 gate op
 * >85%) dezelfde grenzen hanteren. Bewust ondergrens-inclusief (`>= REFINE`, `>= PROPOSE`).
 */

import type { ConversationPhase } from '@intento/shared';

/** Onder deze zekerheid: te onzeker → een nieuwe (bredere) pictogramvraag stellen. */
export const CONFIDENCE_REFINE = 0.6;
/** Vanaf deze zekerheid: zeker genoeg → een boodschap voorstellen (JA/NEE als laatste controle). */
export const CONFIDENCE_PROPOSE = 0.85;

/**
 * Neutrale terugval-zekerheid als een provider géén interpretatie-zekerheid meelevert: midden in de
 * `refine`-band, zodat we noch onnodig een voorstel forceren, noch de intentie als "onbekend" behandelen.
 */
export const DEFAULT_INTERPRETATION_CONFIDENCE = 0.7;

/**
 * Terugval-zekerheid voor een **AI-gegenereerde boodschap** (T5.3) als de provider geen `confidence`
 * meelevert. Een voorstel wordt pas gedaan in de `propose`-fase (>85%, of een eindconcept), dus de zin
 * hoort bij een reeds zekere route: we melden een hoge waarde boven de voorsteldrempel.
 */
export const DEFAULT_MESSAGE_CONFIDENCE = 0.9;

/**
 * Bepaalt de fase uit de interpretatie-zekerheid en of de AAC-route een **eindconcept** heeft bereikt
 * (`isLeaf`: geen verdere opties meer). Een eindconcept is altijd `propose`: er valt niets meer te
 * verfijnen, dus we stellen de boodschap voor — ongeacht de zekerheid. Zo blijft de gescripte
 * voorbeeldroute (die op een blad eindigt) een voorstel opleveren.
 */
export function phaseForDecision(confidence: number, isLeaf: boolean): ConversationPhase {
  if (isLeaf || confidence >= CONFIDENCE_PROPOSE) return 'propose';
  if (confidence >= CONFIDENCE_REFINE) return 'refine';
  return 'select';
}

/** Of een fase betekent dat de gebruiker een boodschap voorgesteld kan krijgen (geen vraag meer). */
export function isProposePhase(phase: ConversationPhase): boolean {
  return phase === 'propose';
}
