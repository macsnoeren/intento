import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  caregiverMessageListResponseSchema,
  caregiverMessageResponseSchema,
  type CaregiverMessage,
  type CaregiverMessageListResponse,
  type CaregiverMessageResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { tenantScope } from '../auth/tenant.js';
import type { AccountModel } from '../generated/prisma/models.js';

/**
 * Berichtenlijst voor de begeleider (T13.1, DESIGN §2, §3.3, §3.6, §9.1) en het aftekenen ervan
 * (T13.3).
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
 * **Afhandelen (T13.3).** Een lijst die alleen maar groeit wordt ruis: na een dag weet een begeleider
 * niet meer wat nieuw is en wat al is opgepakt. Daarom kan hij een boodschap **aftekenen**:
 * `POST /caregiver/messages/:id/acknowledge` legt vast wie hem oppakte en wanneer, en de `DELETE`
 * ernaast draait dat terug. Drie keuzes daarbij, alle drie uit DESIGN §2:
 *
 * 1. **De aftekening raakt de boodschap niet aan.** Ze staat in een eigen tabel
 *    (`MessageAcknowledgement`), niet als kolom op `GeneratedMessage`. De zin is een uitspraak van de
 *    gebruiker; "opgepakt" is administratie van de begeleider erover. Zo kan die administratie de
 *    boodschap per constructie niet wijzigen en blijft `GeneratedMessage` na het bevestigen ongemoeid.
 * 2. **Aftekenen verbergt niets.** De API blijft alle boodschappen teruggeven, afgetekend of niet; de
 *    begeleidersapp mag ze rustiger tonen of tijdelijk filteren, maar een boodschap van een gebruiker
 *    verdwijnt nooit uit het systeem omdat een begeleider hem wegklikt.
 * 3. **De stand is gedeeld, niet persoonlijk.** Eén aftekening per boodschap. De vraag is niet "heb ík
 *    dit gezien" maar "is hier al iets mee gedaan" — twee begeleiders die allebei denken dat de ander
 *    het oppakt is precies wat dit voorkomt. Een "nieuw sinds je vorige bezoek"-markering per account
 *    zou dat níet oplossen én stilzwijgend wissen wat je nog moest doen, alleen omdat je even keek.
 *
 * **De grens.** Dezelfde als bij de vraagmodus (`GET /question/users`): een CAREGIVER ziet uitsluitend de
 * gebruikers waaraan hij **gekoppeld** is, een ADMIN alle gebruikers van de eigen organisatie, en beide
 * altijd tenant-gefilterd. De filtering zit in de query — niet in een controle achteraf — zodat een
 * boodschap van een niet-gekoppelde gebruiker er per constructie niet in kan komen. Aftekenen loopt
 * langs exact hetzelfde filter: een boodschap buiten je grens bestaat voor jou niet (404, geen 403, om
 * niet te lekken dát hij bestaat).
 */

/** Query: hoeveel berichten (nieuwste eerst). Begrensd zodat de lijst eindig blijft. */
const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

/** Route-parameter: het boodschap-id uit het pad. */
const idParamsSchema = z.object({ id: z.string().min(1) });

export interface MessageRoutesDeps {
  prisma: PrismaClient;
}

/**
 * `where`-fragment op de gebruiker achter een boodschap: de toegangsgrens van dit account. Een
 * CAREGIVER krijgt alleen boodschappen uit gesprekken van gebruikers waaraan hij gekoppeld is, een
 * ADMIN alle gebruikers van de eigen organisatie. Zo kan er geen boodschap "langs" de koppeling
 * glippen, ook niet bij een latere wijziging elders.
 */
function messageUserScope(account: AccountModel) {
  return account.role === 'CAREGIVER'
    ? { ...tenantScope(account), caregiverLinks: { some: { accountId: account.id } } }
    : tenantScope(account);
}

/** Wat er per boodschap uit de db gehaald moet worden om hem te kunnen tonen. */
const messageInclude = {
  session: {
    select: {
      id: true,
      caregiverQuestion: true,
      user: { select: { id: true, name: true } },
    },
  },
  acknowledgement: {
    select: { createdAt: true, account: { select: { name: true, email: true } } },
  },
} as const;

interface MessageRow {
  id: string;
  message: string;
  createdAt: Date;
  session: { id: string; caregiverQuestion: string | null; user: { id: string; name: string } };
  acknowledgement: { createdAt: Date; account: { name: string | null; email: string } } | null;
}

/**
 * Zet een db-rij om naar de publieke vorm. De naam van de aftekenaar valt terug op zijn e-mailadres:
 * `Account.name` is nullable (geseede en oudere accounts hebben er geen), en "opgepakt door —" helpt
 * niemand die wil weten bij wie hij moet zijn.
 */
function toPublicMessage(row: MessageRow): CaregiverMessage {
  return {
    id: row.id,
    sessionId: row.session.id,
    userId: row.session.user.id,
    userName: row.session.user.name,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    caregiverQuestion: row.session.caregiverQuestion,
    acknowledgedAt: row.acknowledgement ? row.acknowledgement.createdAt.toISOString() : null,
    acknowledgedBy: row.acknowledgement
      ? (row.acknowledgement.account.name ?? row.acknowledgement.account.email)
      : null,
  };
}

export function registerMessageRoutes(app: FastifyInstance, { prisma }: MessageRoutesDeps): void {
  app.get(
    '/caregiver/messages',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<CaregiverMessageListResponse> => {
      const account = requireAccount(request);
      const { limit } = listQuerySchema.parse(request.query);

      const messages = await prisma.generatedMessage.findMany({
        where: { confirmed: true, session: { user: messageUserScope(account) } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: messageInclude,
      });

      return caregiverMessageListResponseSchema.parse({
        messages: messages.map(toPublicMessage),
      });
    },
  );

  /**
   * Zoekt de boodschap **binnen de grens van dit account**. Buiten de grens: 404, met dezelfde tekst
   * als voor een niet-bestaande boodschap — anders verraadt het antwoord dat er een gebruiker met deze
   * boodschap bestaat bij een collega of in een andere organisatie.
   */
  async function findMessageInScope(account: AccountModel, id: string): Promise<{ id: string }> {
    const message = await prisma.generatedMessage.findFirst({
      where: { id, confirmed: true, session: { user: messageUserScope(account) } },
      select: { id: true },
    });
    if (!message) {
      throw new HttpError(404, 'NOT_FOUND', 'Deze boodschap bestaat niet.');
    }
    return message;
  }

  /** Leest de boodschap opnieuw in de publieke vorm, ná het aftekenen/terugdraaien. */
  async function readMessage(id: string): Promise<CaregiverMessageResponse> {
    const row = await prisma.generatedMessage.findUniqueOrThrow({
      where: { id },
      include: messageInclude,
    });
    return caregiverMessageResponseSchema.parse({ message: toPublicMessage(row) });
  }

  app.post(
    '/caregiver/messages/:id/acknowledge',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<CaregiverMessageResponse> => {
      const account = requireAccount(request);
      const { id } = idParamsSchema.parse(request.params);
      await findMessageInScope(account, id);

      // Idempotent én "wie het eerst tekent, tekent": een tweede aftekening laat de eerste staan. Dat
      // is geen technisch detail maar de bedoeling — de vraag is wie het opgepakt heeft, en dat is
      // degene die er als eerste bij was, niet wie er als laatste op de knop drukte.
      await prisma.messageAcknowledgement.upsert({
        where: { messageId: id },
        create: { messageId: id, accountId: account.id },
        update: {},
      });

      return readMessage(id);
    },
  );

  app.delete(
    '/caregiver/messages/:id/acknowledge',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<CaregiverMessageResponse> => {
      const account = requireAccount(request);
      const { id } = idParamsSchema.parse(request.params);
      await findMessageInScope(account, id);

      // Terugdraaien mag iedereen die de boodschap mag zien, niet alleen de aftekenaar: een misklik van
      // een collega moet te herstellen zijn zonder op hem te wachten. `deleteMany` maakt het idempotent
      // (nog niet afgetekend = geen fout). De boodschap zelf wordt hier niet aangeraakt.
      await prisma.messageAcknowledgement.deleteMany({ where: { messageId: id } });

      return readMessage(id);
    },
  );
}
