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
