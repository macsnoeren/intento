import { z } from 'zod';
import {
  interactionModeSchema,
  presentationKindSchema,
  representationSchema,
} from './agent-contract.js';

/**
 * Wat de tablet van een gesprek ziet (INTENTO-NEW-DESIGN §48, §51).
 *
 * Dit is bewust **niet** de presentatie uit het agentcontract: de tablet krijgt geen concepten, geen
 * Vocabulary-ids en geen contact-ids, alleen wat hij moet tonen (woord, ondertekende afbeeldings-URL,
 * plek) en de `ref` waarmee hij een keuze terugmeldt.
 */

export const tabletOptionSchema = z.strictObject({
  ref: z.string().min(1),
  kind: z.enum(['symbol', 'contact']),
  label: z.string(),
  /** Ondertekende, vervallende URL (`/assets/…`), of `null` als er geen afbeelding is. */
  imageUrl: z.string().nullable(),
  representation: representationSchema,
  position: z.number().int().nonnegative(),
});
export type TabletOption = z.infer<typeof tabletOptionSchema>;

export const tabletPresentationSchema = z.strictObject({
  kind: presentationKindSchema,
  mode: interactionModeSchema,
  text: z.string(),
  message: z.string().nullable(),
  options: z.array(tabletOptionSchema),
});
export type TabletPresentation = z.infer<typeof tabletPresentationSchema>;

/** Antwoord van `POST /communication/sessions` en de volgende beurten. */
export const communicationTurnSchema = z.strictObject({
  sessionId: z.string().min(1),
  turn: z.number().int().nonnegative(),
  presentation: tabletPresentationSchema,
});
export type CommunicationTurn = z.infer<typeof communicationTurnSchema>;

/** Hoe lang de gebruiker over een antwoord deed (ms, gemeten op de tablet); hooguit een uur. */
const responseTimeMs = z.number().int().min(0).max(3_600_000).optional();
const turnNumber = z.number().int().nonnegative();

/**
 * Een antwoord op het huidige scherm (§51): JA/NEE, een gekozen optie, of "Geen van deze". `turn` is de
 * beurt van het scherm waarop de gebruiker antwoordde; is dat niet meer het huidige scherm (dubbele
 * tik, tweede tabblad), dan 409.
 */
export const answerRequestSchema = z.union([
  z.strictObject({ turn: turnNumber, answer: z.enum(['yes', 'no']), responseTimeMs }),
  z.strictObject({ turn: turnNumber, optionRef: z.string().min(1).max(200), responseTimeMs }),
  z.strictObject({ turn: turnNumber, noneOfThese: z.literal(true), responseTimeMs }),
]);
export type AnswerRequest = z.infer<typeof answerRequestSchema>;
