import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  caregiverConversationViewSchema,
  questionStartRequestSchema,
  questionStartResponseSchema,
  userListResponseSchema,
  type CaregiverConversationView,
  type QuestionStartResponse,
  type UserListResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AacSymbolModel } from '../generated/prisma/models.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant, tenantScope } from '../auth/tenant.js';
import { assertCaregiverAccess } from '../auth/caregivers.js';
import { userToPublic as toPublic } from '../users/serialize.js';
import { loadChildSymbols, serializeHistory } from '../conversation/engine.js';
import { HttpError } from '../errors.js';

export interface QuestionRoutesDeps {
  prisma: PrismaClient;
}

/**
 * Vraagmodus (T7.1, DESIGN §3.2, §8.2, FR-012).
 *
 * Een **begeleider** (of beheerder) stelt een gebruiker een vraag ("Wat wil je drinken?"). De AI
 * gebruikt de vraag als context en **beperkt de antwoorden**; de gebruiker stelt het antwoord samen op
 * de tablet en bevestigt het zelf (de begeleider bevestigt nooit namens de gebruiker, DESIGN §2, §3.3).
 *
 * Concreet begrenst de bibliotheek de antwoorden: de begeleider kiest naast de vraag een AAC-**topic**
 * (`anchorConcept`, bv. "drink") waarvan de kinderen de mogelijke antwoorden vormen (water/sap/koffie/
 * melk). De vraagmodus-sessie start met dat topic als eerste, vaste stap; de rest van de gespreksflow
 * (`/next`, `/generate`, `/confirm`) loopt daarna via de gewone gespreksroutes op de tablet (device-auth).
 *
 * Toegang is streng: alléén een CAREGIVER die aan de gebruiker **gekoppeld** is (of een ADMIN binnen de
 * eigen organisatie) mag een vraag stellen — tenant-isolatie (`assertSameTenant`) plus de begeleider-
 * koppeling (`assertCaregiverAccess`). Een niet-gekoppelde begeleider krijgt 403 (isolatietest, T2.2).
 *
 * - `GET  /question/users`  — de gebruikers aan wie dit account een vraag mag stellen.
 * - `POST /question/start`  — start een vraagmodus-sessie; de vraag verschijnt in de gebruikersapp.
 * - `GET  /question/users/:id/conversation` — read-only **meekijken** met het lopende gesprek (T7.2).
 */
export function registerQuestionRoutes(app: FastifyInstance, { prisma }: QuestionRoutesDeps): void {
  // Gebruikers waaraan de begeleider/beheerder een vraag mag stellen. Voor een CAREGIVER: alleen de
  // gekoppelde gebruikers; voor een ADMIN: alle gebruikers van de eigen organisatie. Altijd
  // tenant-gefilterd (multi-tenant-isolatie, DESIGN §9.4).
  app.get(
    '/question/users',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<UserListResponse> => {
      const account = requireAccount(request);
      const where =
        account.role === 'CAREGIVER'
          ? { ...tenantScope(account), caregiverLinks: { some: { accountId: account.id } } }
          : { ...tenantScope(account) };
      const users = await prisma.user.findMany({
        where,
        include: { communicationProfile: true },
        orderBy: { createdAt: 'asc' },
      });
      return userListResponseSchema.parse({ users: users.map(toPublic) });
    },
  );

  // Vraag stellen — CAREGIVER (gekoppeld) of ADMIN. Maakt in één transactie een vraagmodus-sessie met de
  // begeleidersvraag én het topic-anker als eerste stap; de tablet pakt de vraag daarna op via
  // `GET /conversation/pending`.
  app.post(
    '/question/start',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request, reply): Promise<QuestionStartResponse> => {
      const account = requireAccount(request);
      const { userId, question, anchorConcept } = questionStartRequestSchema.parse(request.body);

      // Tenant-grens + begeleider-koppeling bewaken vóór er iets wordt aangemaakt.
      const user = await prisma.user.findUnique({ where: { id: userId } });
      assertSameTenant(account, user);
      await assertCaregiverAccess(prisma, account, userId);

      // Het topic-anker moet bestaan én kinderen (antwoordopties) hebben — anders valt er geen antwoord
      // samen te stellen. De bibliotheek begrenst zo de antwoorden (DESIGN §7.6).
      const anchor = await prisma.aacSymbol.findUnique({ where: { concept: anchorConcept } });
      if (!anchor) {
        throw new HttpError(400, 'UNKNOWN_ANCHOR', 'Onbekend onderwerp voor de vraag.');
      }
      const children = await loadChildSymbols(prisma, anchorConcept);
      if (children.length === 0) {
        throw new HttpError(
          400,
          'ANCHOR_WITHOUT_OPTIONS',
          'Dit onderwerp heeft geen antwoordopties; kies een onderwerp met keuzes.',
        );
      }

      // Sessie + vast anker-stap (order 0) in één transactie: de eerste vraag die de gebruiker ziet zijn
      // de kinderen van het anker (bv. de dranken), met de begeleidersvraag als context erboven.
      const session = await prisma.$transaction(async (tx) => {
        const created = await tx.conversationSession.create({
          data: {
            userId,
            status: 'ACTIVE',
            mode: 'question',
            caregiverQuestion: question,
            startedByAccountId: account.id,
          },
        });
        await tx.conversationStep.create({
          data: {
            sessionId: created.id,
            order: 0,
            question,
            selectedConcept: anchor.concept,
            selectedSymbolId: anchor.id,
            confidence: null,
          },
        });
        return created;
      });

      reply.status(201);
      return questionStartResponseSchema.parse({
        sessionId: session.id,
        userId,
        question,
      });
    },
  );

  // Meekijken met het gesprek (T7.2, DESIGN §3.3, §5.2, FR-011). Een begeleider/beheerder ziet de
  // gesprekcontext van een gekoppelde gebruiker: het afgelegde pad (broodkruimel), een eventuele eigen
  // vraag en of de gebruiker in ondersteuningsmodus staat. Bewust **read-only** en zonder AI-aanroep —
  // puur een snapshot uit de opgeslagen stappen; kiezen/bevestigen kan alléén de gebruiker op de tablet.
  // Dezelfde strenge toegang als de rest van de begeleiderinterface: tenant-grens + begeleider-koppeling.
  app.get(
    '/question/users/:id/conversation',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<CaregiverConversationView> => {
      const account = requireAccount(request);
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);

      const user = assertSameTenant(
        account,
        await prisma.user.findUnique({
          where: { id },
          include: { communicationProfile: true },
        }),
      );
      await assertCaregiverAccess(prisma, account, id);

      // Het lopende (actieve) gesprek, meest recent eerst. Geen AI: alleen de opgeslagen stappen.
      const session = await prisma.conversationSession.findFirst({
        where: { userId: id, status: 'ACTIVE' },
        orderBy: { startedAt: 'desc' },
      });

      // Losjes getypt: het eindresultaat wordt door `caregiverConversationViewSchema` gevalideerd,
      // die `status`/`mode` op de grens controleert (§8.1).
      let sessionView: Record<string, unknown> | null = null;
      if (session) {
        const steps = await prisma.conversationStep.findMany({
          where: { sessionId: session.id },
          orderBy: { order: 'asc' },
        });
        const symbolIds = steps
          .map((step) => step.selectedSymbolId)
          .filter((sid): sid is string => sid !== null);
        const symbols =
          symbolIds.length > 0
            ? await prisma.aacSymbol.findMany({ where: { id: { in: symbolIds } } })
            : [];
        const byId = new Map<string, AacSymbolModel>(symbols.map((symbol) => [symbol.id, symbol]));
        sessionView = {
          sessionId: session.id,
          status: session.status,
          mode: session.mode,
          caregiverQuestion: session.caregiverQuestion,
          history: serializeHistory(steps, byId),
        };
      }

      return caregiverConversationViewSchema.parse({
        userId: user.id,
        userName: user.name,
        supportMode: user.communicationProfile?.supportMode ?? false,
        session: sessionView,
      });
    },
  );
}
