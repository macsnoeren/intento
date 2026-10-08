import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  experienceClearResponseSchema,
  interactionModeSchema,
  userExperienceSchema,
  type ExperienceClearResponse,
  type UserExperience,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Encryptor } from '../crypto/encryption.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant } from '../auth/tenant.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';
import { signedAssetUrl } from '../vocabulary/assets.js';
import {
  EXPERIENCE_AGENT,
  EXPERIENCE_NOTE_KIND,
  experienceNotePayloadSchema,
} from '../experience/observations.js';

/**
 * Ervaring van een gebruiker (N12.3, INTENTO-NEW-DESIGN §22, §49).
 *
 * `GET /users/:id/experience` — wat Intento van deze gebruiker geleerd heeft: welke pictogrammen,
 *   contacten en vormen hij het vaakst koos (de tellingen uit N12.1). De beheeromgeving zet dat om in
 *   gewone taal.
 *   Plus de laatste observaties van de Experience Agent (N12.4): geen waarheid.
 * `DELETE /users/:id/experience` — "Ervaring wissen": alle tellingen en observaties van deze gebruiker
 *   weg. Gesprekken die al bekeken waren, tellen daarna niet opnieuw mee; de ervaring begint echt
 *   opnieuw.
 *
 * Alleen de beheerder, alleen voor een gebruiker van de eigen organisatie (anders 403, zonder te
 * verraden of het id bestaat). Beide geaudit; contactnamen en woorden komen niet in het audit-log.
 */

/** De bovenste paar symbolen; meer zegt een beheerder niets ("kiest vaak …"). */
const TOP_SYMBOLS = 12;
/** De laatste zoveel gesprekken met observaties. */
const NOTE_SESSIONS = 10;

/** Waar de observaties van een gebruiker staan: inferences op zijn gesprekken. */
function noteScope(user: { id: string; organizationId: string }) {
  return {
    agent: EXPERIENCE_AGENT,
    kind: EXPERIENCE_NOTE_KIND,
    session: { userId: user.id, organizationId: user.organizationId },
  };
}

const userParamsSchema = z.object({ id: z.string().min(1).max(200) });
const labelsSchema = z.array(z.string());

export function registerExperienceRoutes(
  app: FastifyInstance,
  { env, prisma, encryptor }: { env: Env; prisma: PrismaClient; encryptor: Encryptor },
): void {
  const guard = { preHandler: authorize(prisma, { roles: ['ADMIN'] }) };

  app.get('/users/:id/experience', guard, async (request): Promise<UserExperience> => {
    const account = requireAccount(request);
    const { id } = userParamsSchema.parse(request.params);
    const user = assertSameTenant(
      account,
      await prisma.user.findUnique({
        where: { id },
        include: { communicationProfile: { select: { experienceEnabled: true } } },
      }),
    );
    const scope = { userId: user.id, organizationId: user.organizationId };
    const order = [
      { chosen: 'desc' as const },
      { presented: 'desc' as const },
      { id: 'asc' as const },
    ];
    const [symbols, symbolCount, contacts, modes, noteRows] = await Promise.all([
      prisma.experienceStat.findMany({
        where: { ...scope, subjectType: 'symbol' },
        orderBy: order,
        take: TOP_SYMBOLS,
      }),
      prisma.experienceStat.count({ where: { ...scope, subjectType: 'symbol' } }),
      prisma.experienceStat.findMany({
        where: { ...scope, subjectType: 'contact' },
        orderBy: order,
      }),
      prisma.experienceStat.findMany({ where: { ...scope, subjectType: 'mode' }, orderBy: order }),
      prisma.inference.findMany({
        where: noteScope(user),
        orderBy: { createdAt: 'desc' },
        take: NOTE_SESSIONS,
        select: { payloadEncrypted: true, createdAt: true },
      }),
    ]);

    // Woord en afbeelding bij elk symbool; ook van een ingetrokken item (de beheerder zag het zo).
    const items = new Map(
      (
        await prisma.vocabularyItem.findMany({
          where: { id: { in: symbols.map((s) => s.subjectRef) } },
          select: { id: true, labels: true, status: true, assetPath: true },
        })
      ).map((item) => [item.id, item]),
    );
    // Contactnamen alleen van contacten van déze gebruiker die nog bestaan.
    const people = new Map(
      (
        await prisma.contact.findMany({
          where: { ...scope, id: { in: contacts.map((c) => c.subjectRef) } },
          select: { id: true, nameEncrypted: true },
        })
      ).map((contact) => [contact.id, encryptor.decrypt(contact.nameEncrypted)]),
    );

    const now = new Date();
    const counts = (row: (typeof symbols)[number]) => ({
      presented: row.presented,
      chosen: row.chosen,
      chosenAtFirstPosition: row.chosenAtFirstPosition,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    });
    await recordAudit(prisma, request, {
      action: AUDIT_ACTIONS.EXPERIENCE_VIEW,
      targetType: 'user',
      targetId: user.id,
    });
    return userExperienceSchema.parse({
      enabled: user.communicationProfile?.experienceEnabled ?? true,
      symbols: symbols.flatMap((row) => {
        const item = items.get(row.subjectRef);
        if (!item) return [];
        return [
          {
            id: item.id,
            label: labelsSchema.parse(item.labels)[0] ?? item.id,
            imageUrl:
              item.status === 'approved' && item.assetPath ? signedAssetUrl(env, item, now) : null,
            ...counts(row),
          },
        ];
      }),
      contacts: contacts.flatMap((row) => {
        const name = people.get(row.subjectRef);
        return name === undefined ? [] : [{ id: row.subjectRef, name, ...counts(row) }];
      }),
      modes: modes.flatMap((row) => {
        const mode = interactionModeSchema.safeParse(row.subjectRef);
        return mode.success ? [{ mode: mode.data, ...counts(row) }] : [];
      }),
      symbolCount,
      notes: noteRows.flatMap((row) =>
        experienceNotePayloadSchema
          .parse(JSON.parse(encryptor.decrypt(row.payloadEncrypted)))
          .notes.map((note) => ({ ...note, createdAt: row.createdAt.toISOString() })),
      ),
    });
  });

  app.delete('/users/:id/experience', guard, async (request): Promise<ExperienceClearResponse> => {
    const account = requireAccount(request);
    const { id } = userParamsSchema.parse(request.params);
    const user = assertSameTenant(account, await prisma.user.findUnique({ where: { id } }));
    const [stats, notes] = await prisma.$transaction([
      prisma.experienceStat.deleteMany({
        where: { userId: user.id, organizationId: user.organizationId },
      }),
      prisma.inference.deleteMany({ where: noteScope(user) }),
    ]);
    const count = stats.count + notes.count;
    await recordAudit(prisma, request, {
      action: AUDIT_ACTIONS.EXPERIENCE_CLEAR,
      targetType: 'user',
      targetId: user.id,
      metadata: { deleted: count },
    });
    return experienceClearResponseSchema.parse({ deleted: count });
  });
}
