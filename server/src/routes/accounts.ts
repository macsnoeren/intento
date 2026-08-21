import type { FastifyInstance } from 'fastify';
import {
  accountListResponseSchema,
  createCaregiverRequestSchema,
  createCaregiverResponseSchema,
  type AccountListResponse,
  type CreateCaregiverResponse,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { authorize, requireAccount, requireVerifiedEmail } from '../auth/authorize.js';
import { createCaregiverAccount } from '../auth/caregiver-account.js';
import { sendVerificationEmail } from '../auth/email-verification.js';
import { accountToPublic as toPublic } from '../auth/serialize.js';
import { tenantScope } from '../auth/tenant.js';
import type { MailTransport } from '../mail/transport.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';

export interface AccountRoutesDeps {
  env: Env;
  prisma: PrismaClient;
  mail: MailTransport;
}

/**
 * Account-routes (T1.2, T2.4, DESIGN §2, §5.2, §9.4). Beheer van de **logins** binnen één
 * organisatie — tenant-gebonden en ADMIN-only:
 *
 * `GET  /admin/accounts` — lijst van logins **binnen de eigen organisatie**. De query wordt via
 * `tenantScope(account)` op `organizationId` gefilterd, dus een beheerder ziet nooit accounts van
 * een andere organisatie.
 *
 * `POST /admin/accounts` — maakt een **begeleider-account** (rol vast op CAREGIVER) in de eigen
 * organisatie en geeft het server-gegenereerde tijdelijke wachtwoord één keer terug (T2.4).
 */
export function registerAccountRoutes(
  app: FastifyInstance,
  { env, prisma, mail }: AccountRoutesDeps,
): void {
  app.get(
    '/admin/accounts',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<AccountListResponse> => {
      const account = requireAccount(request);
      const accounts = await prisma.account.findMany({
        where: { ...tenantScope(account) },
        orderBy: { createdAt: 'asc' },
      });
      return accountListResponseSchema.parse({ accounts: accounts.map(toPublic) });
    },
  );

  // Begeleider aanmaken — ADMIN, én e-mail geverifieerd (T1.4). Dezelfde gate als `POST /users`:
  // een nieuw account is een toegangsverlening tot privacygevoelige gegevens van echte personen,
  // dus de beheerder moet eerst zijn eigen adres hebben bevestigd.
  app.post(
    '/admin/accounts',
    { preHandler: [authorize(prisma, { roles: ['ADMIN'] }), requireVerifiedEmail()] },
    async (request, reply): Promise<CreateCaregiverResponse> => {
      const admin = requireAccount(request);
      const input = createCaregiverRequestSchema.parse(request.body);

      // Rol en organisatie komen van de server, nooit uit de body: geen privilege-escalatie naar
      // ADMIN en geen account in een andere tenant, ongeacht wat er is meegestuurd.
      const result = await createCaregiverAccount(prisma, admin.organizationId, input);

      if (!result.ok) {
        // Bewust generiek (zoals bij registratie, T1.3): geen bevestiging dat dit e-mailadres al
        // ergens een account heeft — dat zou account-enumeratie over tenants heen opleveren.
        throw new HttpError(
          409,
          'ACCOUNT_CREATE_FAILED',
          'Dit account kon niet worden aangemaakt. Controleer het e-mailadres of gebruik een ander adres.',
        );
      }

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.ACCOUNT_CREATE,
        targetType: 'account',
        targetId: result.account.id,
        // Alleen de rol als context — nooit het (tijdelijke) wachtwoord of de hash.
        metadata: { role: result.account.role },
      });

      // Verificatiemail voor de nieuwe begeleider (T1.4). Best-effort: een falende mailserver mag
      // het aanmaken niet laten mislukken — de beheerder heeft het tijdelijke wachtwoord al en de
      // begeleider kan later "opnieuw versturen" gebruiken.
      try {
        await sendVerificationEmail(prisma, mail, env, result.account);
      } catch (error) {
        request.log.error({ err: error }, 'Verificatiemail versturen mislukt bij nieuw account');
      }

      reply.status(201);
      // Het rauwe tijdelijke wachtwoord verlaat de server hier één keer; daarna kent de db alleen
      // de argon2id-hash en is het niet meer op te vragen.
      return createCaregiverResponseSchema.parse({
        account: toPublic(result.account),
        temporaryPassword: result.temporaryPassword,
      });
    },
  );
}
