import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  sessionListQuerySchema,
  sessionListResponseSchema,
  sessionReviewSchema,
  type ReviewTurn,
  type SessionListResponse,
  type SessionReview,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Encryptor } from '../crypto/encryption.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant } from '../auth/tenant.js';
import { HttpError } from '../errors.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';
import { readProvenance } from '../communication/provenance.js';

/**
 * Een gesprek terugzien (N14.1, INTENTO-NEW-DESIGN §26, §27, §49).
 *
 * `GET /users/:id/sessions?page=&pageSize=` — de gesprekken van een gebruiker, nieuwste eerst: wanneer,
 *   hoe het afliep en hoeveel schermen. Geen inhoud.
 * `GET /communication/sessions/:id/provenance` — één gesprek per beurt in drie kolommen: Getoond
 *   (Presented), Gekozen (Observed) en Gedacht (Inferred), plus de agentbeslissingen (agent, status,
 *   model, promptversie, duur, validatie). De drie blijven gescheiden, zoals ze zijn opgeslagen.
 *   Ontsleuteld, dus geaudit als `session.view`.
 *
 * Alleen de beheerder, alleen de eigen organisatie: een gesprek of gebruiker van een andere organisatie
 * en een onbekend id geven allebei 403 (IDOR-mitigatie, ADR-0005). Wat er is, staat er alleen binnen de
 * bewaartermijn (§53).
 */

const idParamsSchema = z.object({ id: z.string().min(1).max(200) });
const jsonSchema = z.json();
const statusSchema = z.enum(['active', 'confirmed', 'stopped']);

/** Een gesprek loopt nog zolang het niet geëindigd is, ook als het al bevestigd is. */
function displayStatus(session: { status: string; endedAt: Date | null }) {
  return session.endedAt === null ? 'active' : statusSchema.catch('stopped').parse(session.status);
}

export function registerSessionReviewRoutes(
  app: FastifyInstance,
  { prisma, encryptor }: { prisma: PrismaClient; encryptor: Encryptor },
): void {
  const guard = { preHandler: authorize(prisma, { roles: ['ADMIN'] }) };

  app.get('/users/:id/sessions', guard, async (request): Promise<SessionListResponse> => {
    const account = requireAccount(request);
    const { id } = idParamsSchema.parse(request.params);
    const { page, pageSize } = sessionListQuerySchema.parse(request.query);
    const user = assertSameTenant(account, await prisma.user.findUnique({ where: { id } }));
    const where = { userId: user.id, organizationId: user.organizationId };
    const [rows, total] = await Promise.all([
      prisma.communicationSession.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          status: true,
          _count: { select: { presentationEvents: true } },
        },
      }),
      prisma.communicationSession.count({ where }),
    ]);
    return sessionListResponseSchema.parse({
      items: rows.map((row) => ({
        id: row.id,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt?.toISOString() ?? null,
        status: displayStatus(row),
        screens: row._count.presentationEvents,
      })),
      total,
      page,
      pageSize,
    });
  });

  app.get(
    '/communication/sessions/:id/provenance',
    guard,
    async (request): Promise<SessionReview> => {
      const account = requireAccount(request);
      const { id } = idParamsSchema.parse(request.params);
      const session = await prisma.communicationSession.findFirst({
        where: { id, organizationId: account.organizationId },
        include: { user: { select: { id: true, name: true } } },
      });
      const provenance = session
        ? await readProvenance(prisma, encryptor, {
            sessionId: session.id,
            organizationId: account.organizationId,
          })
        : null;
      if (!session || !provenance) {
        throw new HttpError(403, 'FORBIDDEN', 'Je hebt geen toegang tot dit gesprek.');
      }

      // Per beurt, in volgorde; elke soort apart (nooit samengevoegd, §2.5).
      const turns = new Map<number, ReviewTurn>();
      const at = (turn: number): ReviewTurn => {
        const existing = turns.get(turn);
        if (existing) return existing;
        const created: ReviewTurn = {
          turn,
          presented: null,
          observed: [],
          inferred: [],
          decisions: [],
        };
        turns.set(turn, created);
        return created;
      };
      for (const shown of provenance.presented) {
        at(shown.turn).presented = {
          kind: shown.kind,
          mode: shown.mode,
          text: shown.text,
          message: shown.message,
          options: shown.options.map((option) => ({
            ref: option.ref,
            kind: option.kind,
            label: option.label,
            concept: option.concept,
            representation: option.representation,
            position: option.position,
          })),
        };
      }
      for (const { turn, ...event } of provenance.observed) at(turn).observed.push(event);
      for (const { turn, ...inference } of provenance.inferred) {
        at(turn).inferred.push({ ...inference, payload: jsonSchema.parse(inference.payload) });
      }
      for (const { turn, ...decision } of provenance.decisions) at(turn).decisions.push(decision);

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.SESSION_VIEW,
        targetType: 'communicationSession',
        targetId: session.id,
        metadata: { userId: session.userId },
      });
      return sessionReviewSchema.parse({
        session: {
          id: session.id,
          user: session.user,
          startedAt: session.startedAt.toISOString(),
          endedAt: session.endedAt?.toISOString() ?? null,
          status: displayStatus(session),
        },
        turns: [...turns.values()].sort((a, b) => a.turn - b.turn),
      });
    },
  );
}
