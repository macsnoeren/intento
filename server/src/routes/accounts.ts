import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  accountListResponseSchema,
  createCaregiverRequestSchema,
  createCaregiverResponseSchema,
  resetAccountPasswordResponseSchema,
  type AccountListResponse,
  type CreateCaregiverResponse,
  type ResetAccountPasswordResponse,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { authorize, requireAccount, requireVerifiedEmail } from '../auth/authorize.js';
import { createCaregiverAccount } from '../auth/caregiver-account.js';
import { resetTemporaryPassword } from '../auth/reset-password.js';
import { sendVerificationEmail } from '../auth/email-verification.js';
import { accountToPublic as toPublic } from '../auth/serialize.js';
import { assertSameTenant, tenantScope } from '../auth/tenant.js';
import type { MailTransport } from '../mail/transport.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';

export interface AccountRoutesDeps {
  env: Env;
  prisma: PrismaClient;
  mail: MailTransport;
}

/** Pad-parameter van de accountroutes; ook de id komt via zod binnen (CLAUDE.md §7). */
const accountParamsSchema = z.object({ id: z.string().min(1) });

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
 *
 * `POST /admin/accounts/{id}/password` — geeft een **nieuw** tijdelijk wachtwoord uit voor een
 * vastgelopen account in de eigen organisatie en trekt al zijn sessies in (T2.7).
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

  // --- Nieuw tijdelijk wachtwoord uitgeven (T2.7) ---

  // Enige weg terug voor een account dat vastzit: het tijdelijke wachtwoord uit T2.4 kwijt, of
  // buitengesloten door de lockout. Inloggen lukt dan niet, en zonder sessie is `POST /auth/password`
  // (T2.5) onbereikbaar. De beheerder geeft hier een nieuw server-gegenereerd tijdelijk wachtwoord
  // uit; hij kiest het dus niet zelf en het is meteen weer aan `mustChangePassword` gebonden.
  //
  // Dezelfde gates als bij aanmaken (ADMIN + geverifieerd adres) plus rate limiting: de actie is
  // zeldzaam en trekt alle sessies van een collega in.
  app.post(
    '/admin/accounts/:id/password',
    {
      preHandler: [authorize(prisma, { roles: ['ADMIN'] }), requireVerifiedEmail()],
      config: {
        rateLimit: {
          max: env.PASSWORD_RESET_RATE_LIMIT_MAX,
          timeWindow: env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
        },
      },
    },
    async (request): Promise<ResetAccountPasswordResponse> => {
      const admin = requireAccount(request);
      const { id } = accountParamsSchema.parse(request.params);

      // Nooit het eigen account: een beheerder die zijn wachtwoord wil wisselen doet dat via
      // `POST /auth/password` (T2.5, mét huidig wachtwoord). Hier zou hij zichzelf zonder
      // her-authenticatie een nieuw wachtwoord kunnen geven — precies wat T2.5 uitsluit — en
      // zichzelf bovendien uit zijn eigen sessie werken.
      if (id === admin.id) {
        throw new HttpError(
          403,
          'CANNOT_RESET_OWN_PASSWORD',
          'Wijzig je eigen wachtwoord via “Wachtwoord wijzigen”; daar hoort je huidige wachtwoord bij.',
        );
      }

      // Tenant-grens: `assertSameTenant` geeft dezelfde 403 voor "bestaat niet" en "andere
      // organisatie", zodat het bestaan van accounts elders niet lekt (IDOR-mitigatie).
      const target = assertSameTenant(admin, await prisma.account.findUnique({ where: { id } }));

      const result = await resetTemporaryPassword(prisma, target.id);

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.ACCOUNT_PASSWORD_RESET,
        targetType: 'account',
        targetId: target.id,
        // Alleen context — nooit het wachtwoord of de hash.
        metadata: { role: target.role, revokedSessions: result.revokedSessions },
      });

      // Het rauwe wachtwoord verlaat de server hier één keer; daarna kent de db alleen de hash.
      return resetAccountPasswordResponseSchema.parse({
        account: toPublic(result.account),
        temporaryPassword: result.temporaryPassword,
        revokedSessions: result.revokedSessions,
      });
    },
  );
}
