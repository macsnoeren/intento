import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import { storedOptionSchema } from '../communication/provenance.js';
import { tallySession } from './tally.js';

/**
 * Experience na afloop van een gesprek (N12.1, INTENTO-NEW-DESIGN §21 laag 1, §22).
 *
 * Als een gesprek eindigt, telt de backend uit Presented en Observed per symbool, contact en vorm hoe
 * vaak het getoond en gekozen werd (zie `tally.ts`) en telt dat op bij de `ExperienceStat` van de
 * gebruiker. Alleen als Experience voor die gebruiker aanstaat: staat hij uit, dan wordt er niets
 * opgebouwd — ook niet achteraf, want elk gesprek wordt hoe dan ook maar één keer bekeken
 * (`experienceCountedAt`). Dat claimen en optellen gebeurt in één transactie: twee keer afsluiten telt
 * nooit dubbel.
 */

const optionsSchema = z.array(storedOptionSchema);

/** Telt een afgerond gesprek mee; `false` als er niets geteld werd (al geteld, loopt nog, of uit). */
export async function recordSessionExperience(
  prisma: PrismaClient,
  sessionId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.communicationSession.updateMany({
      where: { id: sessionId, endedAt: { not: null }, experienceCountedAt: null },
      data: { experienceCountedAt: now },
    });
    if (claimed.count === 0) return false;

    const session = await tx.communicationSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: {
        userId: true,
        organizationId: true,
        status: true,
        user: { select: { communicationProfile: { select: { experienceEnabled: true } } } },
      },
    });
    // Zonder profiel geldt de standaard: aan (§22).
    if (session.user.communicationProfile?.experienceEnabled === false) return false;

    const where = { sessionId };
    const [presented, observed] = await Promise.all([
      tx.presentationEvent.findMany({
        where,
        select: { turn: true, kind: true, mode: true, optionsJson: true },
      }),
      tx.observedEvent.findMany({ where, select: { turn: true, type: true, optionRef: true } }),
    ]);
    const tallies = tallySession(
      presented.map((row) => ({ ...row, options: optionsSchema.parse(row.optionsJson) })),
      observed,
      session.status === 'confirmed',
    );

    for (const tally of tallies) {
      const used = tally.chosen > 0 ? now : null;
      await tx.experienceStat.upsert({
        where: {
          userId_subjectType_subjectRef: {
            userId: session.userId,
            subjectType: tally.subjectType,
            subjectRef: tally.subjectRef,
          },
        },
        create: {
          userId: session.userId,
          organizationId: session.organizationId,
          subjectType: tally.subjectType,
          subjectRef: tally.subjectRef,
          presented: tally.presented,
          chosen: tally.chosen,
          chosenAtFirstPosition: tally.chosenAtFirstPosition,
          lastUsedAt: used,
        },
        update: {
          presented: { increment: tally.presented },
          chosen: { increment: tally.chosen },
          chosenAtFirstPosition: { increment: tally.chosenAtFirstPosition },
          ...(used ? { lastUsedAt: used } : {}),
        },
      });
    }
    return true;
  });
}
