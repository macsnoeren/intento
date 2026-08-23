import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  caregiverMessageListResponseSchema,
  type CaregiverMessageListResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { tenantScope } from '../auth/tenant.js';

/**
 * Berichtenlijst voor de begeleider (T13.1, DESIGN §2, §3.3, §3.6, §9.1).
 *
 * **Waarom deze route bestaat.** Een gebruiker komt tot een zin en bevestigt hem — en dan gebeurde er
 * niets. De boodschap bleef staan in de database en op zijn eigen tablet; wie hem moest horen, moest
 * toevallig meekijken. Daarmee stopte de communicatie precies op het punt waar ze zou moeten beginnen:
 * iemand vraagt om iets, en er is niemand die het ziet.
 *
 * De lijst toont per boodschap **wat** er gezegd is, **wanneer** en **door wie**, nieuwste eerst. Er
 * wordt niets nieuws opgeslagen: `GeneratedMessage` bewaart elke bevestigde boodschap al met haar
 * tijdstip (T4.3). Dat is ook de grens van wat hier kan verschijnen — een voorstel dat de gebruiker
 * **afwees** wordt nooit opgeslagen (§3.6), dus een afgewezen zin bereikt nooit een begeleider.
 *
 * **De grens.** Dezelfde als bij de vraagmodus (`GET /question/users`): een CAREGIVER ziet uitsluitend de
 * gebruikers waaraan hij **gekoppeld** is, een ADMIN alle gebruikers van de eigen organisatie, en beide
 * altijd tenant-gefilterd. De filtering zit in de query — niet in een controle achteraf — zodat een
 * boodschap van een niet-gekoppelde gebruiker er per constructie niet in kan komen.
 */

/** Query: hoeveel berichten (nieuwste eerst). Begrensd zodat de lijst eindig blijft. */
const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export interface MessageRoutesDeps {
  prisma: PrismaClient;
}

export function registerMessageRoutes(app: FastifyInstance, { prisma }: MessageRoutesDeps): void {
  app.get(
    '/caregiver/messages',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<CaregiverMessageListResponse> => {
      const account = requireAccount(request);
      const { limit } = listQuerySchema.parse(request.query);

      // De toegangsgrens zit in het `where`-fragment: een CAREGIVER krijgt alleen boodschappen uit
      // gesprekken van gebruikers waaraan hij gekoppeld is. Zo kan er geen boodschap "langs" de
      // koppeling glippen, ook niet bij een latere wijziging elders.
      const userScope =
        account.role === 'CAREGIVER'
          ? { ...tenantScope(account), caregiverLinks: { some: { accountId: account.id } } }
          : tenantScope(account);

      const messages = await prisma.generatedMessage.findMany({
        where: { confirmed: true, session: { user: userScope } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          session: {
            select: {
              id: true,
              caregiverQuestion: true,
              user: { select: { id: true, name: true } },
            },
          },
        },
      });

      return caregiverMessageListResponseSchema.parse({
        messages: messages.map((entry) => ({
          id: entry.id,
          sessionId: entry.session.id,
          userId: entry.session.user.id,
          userName: entry.session.user.name,
          message: entry.message,
          createdAt: entry.createdAt.toISOString(),
          caregiverQuestion: entry.session.caregiverQuestion,
        })),
      });
    },
  );
}
