import {
  presentationSchema,
  sessionStateSchema,
  type Presentation,
  type SessionState,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { CommunicationSessionModel } from '../generated/prisma/models.js';
import type { Encryptor } from '../crypto/encryption.js';

/**
 * Gesprekken en hun momentopnamen (INTENTO-NEW-DESIGN §5, §39, §53).
 *
 * De backend is de enige eigenaar van de Session State. Per beurt bewaart hij een **versleutelde**
 * momentopname van de state en van wat er op het scherm stond. Bij het lezen gaan beide opnieuw door
 * zod: wat uit de database komt, vertrouwen we niet blind.
 *
 * Elke opvraging is gebonden aan de gebruiker (en daarmee de organisatie): een apparaat ziet nooit een
 * gesprek van een andere gebruiker.
 */

export const SESSION_STATUSES = ['active', 'confirmed', 'stopped'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface TurnSnapshot {
  turn: number;
  previousTurn: number | null;
  state: SessionState;
  presentation: Presentation;
}

export async function createSession(
  prisma: PrismaClient,
  owner: { userId: string; organizationId: string },
): Promise<CommunicationSessionModel> {
  return prisma.communicationSession.create({
    data: { ...owner, status: 'active', currentTurn: 0 },
  });
}

/** Het gesprek van déze gebruiker met dit id, of `null` (ook als het van een ander is). */
export function findSessionForUser(
  prisma: PrismaClient,
  sessionId: string,
  userId: string,
): Promise<CommunicationSessionModel | null> {
  return prisma.communicationSession.findFirst({ where: { id: sessionId, userId } });
}

/** Het lopende gesprek van een gebruiker, of `null`. */
export function findActiveSession(
  prisma: PrismaClient,
  userId: string,
): Promise<CommunicationSessionModel | null> {
  return prisma.communicationSession.findFirst({
    where: { userId, status: 'active' },
    orderBy: { startedAt: 'desc' },
  });
}

/** Slaat een momentopname op (versleuteld) en maakt hem de huidige beurt van het gesprek. */
export async function saveTurn(
  prisma: PrismaClient,
  encryptor: Encryptor,
  sessionId: string,
  snapshot: TurnSnapshot,
): Promise<void> {
  await prisma.$transaction([
    prisma.sessionTurn.create({
      data: {
        sessionId,
        turn: snapshot.turn,
        previousTurn: snapshot.previousTurn,
        stateEncrypted: encryptor.encrypt(JSON.stringify(sessionStateSchema.parse(snapshot.state))),
        presentationEncrypted: encryptor.encrypt(
          JSON.stringify(presentationSchema.parse(snapshot.presentation)),
        ),
      },
    }),
    prisma.communicationSession.update({
      where: { id: sessionId },
      data: { currentTurn: snapshot.turn },
    }),
  ]);
}

/** Leest en ontsleutelt een momentopname; `null` als die beurt niet bestaat. */
export async function loadTurn(
  prisma: PrismaClient,
  encryptor: Encryptor,
  sessionId: string,
  turn: number,
): Promise<TurnSnapshot | null> {
  const row = await prisma.sessionTurn.findUnique({
    where: { sessionId_turn: { sessionId, turn } },
  });
  if (!row) return null;
  return {
    turn: row.turn,
    previousTurn: row.previousTurn,
    state: sessionStateSchema.parse(JSON.parse(encryptor.decrypt(row.stateEncrypted))),
    presentation: presentationSchema.parse(
      JSON.parse(encryptor.decrypt(row.presentationEncrypted)),
    ),
  };
}

/** Het hoogste beurtnummer tot nu toe (beurten zijn append-only). */
export async function lastTurnNumber(prisma: PrismaClient, sessionId: string): Promise<number> {
  const row = await prisma.sessionTurn.findFirst({
    where: { sessionId },
    orderBy: { turn: 'desc' },
    select: { turn: true },
  });
  return row?.turn ?? -1;
}

/** Sluit een gesprek af met een eindstatus. */
export async function endSession(
  prisma: PrismaClient,
  sessionId: string,
  status: Exclude<SessionStatus, 'active'>,
  now: Date = new Date(),
): Promise<void> {
  await prisma.communicationSession.update({
    where: { id: sessionId },
    data: { status, endedAt: now },
  });
}
