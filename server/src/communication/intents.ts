import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { CommunicationSessionModel } from '../generated/prisma/models.js';
import type { Encryptor } from '../crypto/encryption.js';
import { HttpError } from '../errors.js';
import { proposalText } from '../agents/invariants.js';
import { confirmSession, type TurnSnapshot } from './sessions.js';

/**
 * De bevestigde boodschap (Communication Intent, INTENTO-NEW-DESIGN §31, §52 I2).
 *
 * Een boodschap is pas de boodschap van de gebruiker na zijn JA op "Bedoel je: …?". Daarom maakt
 * **alleen de backend** hem aan, op het moment dat hij zelf een Observed JA vastlegt op een
 * `confirm_message`-scherm dat hij zelf heeft opgeslagen, en alleen als de schermtekst precies die
 * boodschap vroeg. Wat de agentdienst in zijn state "bevestigd" noemt, wordt nooit gelezen.
 */

export interface ConfirmedIntent {
  turn: number;
  message: string;
  concepts: string[];
  confidence: number | null;
  confirmedAt: Date;
}

/** Legt de boodschap vast na een JA op dit scherm. Gooit 409 als het scherm geen geldig voorstel was. */
export async function confirmIntent(
  prisma: PrismaClient,
  encryptor: Encryptor,
  session: CommunicationSessionModel,
  screen: TurnSnapshot,
): Promise<ConfirmedIntent> {
  const { presentation, state } = screen;
  const message = presentation.message;
  if (
    presentation.kind !== 'confirm_message' ||
    !message ||
    presentation.text !== proposalText(message)
  ) {
    throw new HttpError(409, 'CANNOT_CONFIRM', 'Dit scherm vraagt niet om een bevestiging.');
  }
  // De concepten uit het voorstel als dat bij deze boodschap hoort; anders wat er op het scherm stond.
  const proposal = state.proposal?.message === message ? state.proposal : null;
  const concepts =
    proposal?.concepts ??
    presentation.options
      .map((option) => option.concept)
      .filter((concept): concept is string => Boolean(concept));

  const existing = await findIntent(prisma, encryptor, session.id);
  if (existing) {
    // Dezelfde JA nog eens (de agent faalde na de bevestiging en de tablet probeert opnieuw): dat is
    // geen tweede boodschap. Een JA op een ánder voorstel in hetzelfde gesprek kan niet.
    if (existing.turn === screen.turn) return existing;
    throw new HttpError(409, 'ALREADY_CONFIRMED', 'Deze boodschap is al bevestigd.');
  }
  const row = await prisma.communicationIntent.create({
    data: {
      sessionId: session.id,
      userId: session.userId,
      organizationId: session.organizationId,
      turn: screen.turn,
      messageEncrypted: encryptor.encrypt(message),
      concepts,
      confidence: proposal?.confidence ?? null,
    },
  });
  await confirmSession(prisma, session.id);
  return {
    turn: row.turn,
    message,
    concepts,
    confidence: row.confidence,
    confirmedAt: row.confirmedAt,
  };
}

/** De bevestigde boodschap van een gesprek, ontsleuteld; `null` als er (nog) geen is. */
export async function findIntent(
  prisma: PrismaClient,
  encryptor: Encryptor,
  sessionId: string,
): Promise<ConfirmedIntent | null> {
  const row = await prisma.communicationIntent.findUnique({ where: { sessionId } });
  if (!row) return null;
  return {
    turn: row.turn,
    message: encryptor.decrypt(row.messageEncrypted),
    concepts: z.array(z.string()).parse(row.concepts),
    confidence: row.confidence,
    confirmedAt: row.confirmedAt,
  };
}
