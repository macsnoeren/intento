import { z } from 'zod';
import { conversationPhaseSchema } from '@intento/shared';

/**
 * Het **onbeantwoorde vraagaanbod** van een sessie (T10.3, DESIGN §7.5, ADR-0012).
 *
 * **Waarom dit wordt opgeslagen.** Tot Fase 10 was de volgende vraag een pure functie van de opgeslagen
 * stappen: de kandidaten waren de kinderen van één boomknoop, dus twee aanroepen gaven hetzelfde
 * resultaat. Sinds de kandidaten uit **retrieval** komen (T10.2) en de AI daarbinnen echt kiest, geldt
 * dat niet meer — een tweede aanroep kan andere opties opleveren. Zonder vastlegging zou dat twee dingen
 * breken:
 *
 *  1. **`↩ Terug` zou niet exact herstellen** (T4.1): de gebruiker kreeg na terug een ánder scherm dan
 *     hij net zag.
 *  2. **Een geldige keuze zou geweigerd kunnen worden**: `resolveOption` valideerde de keuze tegen de
 *     boom, dus elke AI-keuze buiten de boom zou `400 INVALID_CHOICE` opleveren.
 *
 * Daarom bewaart de sessie het aanbod tot het beantwoord is, en bewaart elke stap wat er bij die vraag
 * is aangeboden (`ConversationStep.offeredConcepts`). `stepCount` maakt het aanbod zelf-invaliderend:
 * hoort het niet bij het huidige aantal stappen, dan wordt er een nieuwe beslissing genomen.
 */
export const pendingOfferSchema = z.object({
  /** Bij hoeveel gezette stappen dit aanbod hoort; wijkt dat af, dan is het aanbod verouderd. */
  stepCount: z.number().int().min(0),
  /** De getoonde vraagtekst. */
  question: z.string(),
  /** De aangeboden concepten, in de getoonde volgorde. */
  concepts: z.array(z.string()),
  /** De (gedempte) interpretatie-zekerheid van de beslissing achter dit aanbod. */
  confidence: z.number().min(0).max(1),
  /** De fase volgens §7.4. */
  phase: conversationPhaseSchema,
  /**
   * Het concept van de optie die als **gok** is aangeboden (T16.3, strategie `guess`); `null` bij elke
   * andere strategie. Hoort bij het aanbod en niet bij de beslissing van dit moment: `↩ Terug` moet
   * exact hetzelfde scherm herstellen — inclusief wélke tegel gemarkeerd was.
   */
  guess: z.string().nullable().optional(),
});
export type PendingOffer = z.infer<typeof pendingOfferSchema>;

/**
 * Leest het bewaarde aanbod van een sessie en controleert of het bij het huidige aantal stappen hoort.
 * Geeft `null` bij afwezigheid, een niet-kloppende vorm (oude/corrupte blob mag de flow niet laten
 * falen) of een verouderd aanbod.
 */
export function readPendingOffer(value: unknown, stepCount: number): PendingOffer | null {
  if (value === null || value === undefined) return null;
  const parsed = pendingOfferSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data.stepCount === stepCount ? parsed.data : null;
}

/** Leest de opgeslagen aangeboden concepten van een stap; een niet-kloppende vorm telt als leeg. */
export function readOfferedConcepts(value: unknown): string[] {
  const parsed = z.array(z.string()).safeParse(value);
  return parsed.success ? parsed.data : [];
}
