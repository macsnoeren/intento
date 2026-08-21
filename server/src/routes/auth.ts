import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  changePasswordRequestSchema,
  changePasswordResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
  resendVerificationRequestSchema,
  verifyEmailRequestSchema,
  type AuthResponse,
  type ChangePasswordResponse,
  type ResendVerificationResponse,
  type VerifyEmailResponse,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { verifyLogin } from '../auth/service.js';
import { registerOrganization } from '../auth/register.js';
import { changeOwnPassword } from '../auth/change-password.js';
import { createSession, deleteSessionByToken, findAccountBySessionToken } from '../auth/session.js';
import {
  isOrganizationActive,
  ORGANIZATION_SUSPENDED_MESSAGE,
} from '../auth/organization-status.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '../auth/cookie.js';
import { readSessionToken } from '../auth/request.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { accountToPublic as toPublic } from '../auth/serialize.js';
import { sendVerificationEmail, verifyEmailToken } from '../auth/email-verification.js';
import type { MailTransport } from '../mail/transport.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';

export interface AuthRoutesDeps {
  env: Env;
  prisma: PrismaClient;
  mail: MailTransport;
}

/** Neutrale melding op /auth/verify-email/resend — altijd hetzelfde (geen account-enumeratie). */
const RESEND_NEUTRAL_MESSAGE =
  'Als dit e-mailadres bij ons bekend is en nog niet is bevestigd, is er een nieuwe verificatiemail verstuurd.';

/**
 * Auth-routes (T1.1, T1.4, DESIGN §8.2): login, logout, het eigen account, en e-mailverificatie.
 *
 * Login is streng rate-limited (per IP) én kent account-lockout; sessietokens gaan als
 * ondertekende httpOnly+Secure cookie mee en staan alleen gehasht in de db. E-mailverificatie
 * (T1.4) stuurt bij registratie een verificatiemail en wisselt het (gehashte, eenmalige,
 * verlopende) token weer in; opnieuw versturen is publiek, rate-limited en lekt niet of het adres
 * bestaat.
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  { env, prisma, mail }: AuthRoutesDeps,
): void {
  const sessionMaxAgeSeconds = env.SESSION_TTL_HOURS * 60 * 60;

  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: env.LOGIN_RATE_LIMIT_MAX,
          timeWindow: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
        },
      },
    },
    async (request, reply): Promise<AuthResponse> => {
      const { email, password } = loginRequestSchema.parse(request.body);

      const result = await verifyLogin(prisma, email, password, {
        maxAttempts: env.LOGIN_MAX_ATTEMPTS,
        lockoutMinutes: env.LOGIN_LOCKOUT_MINUTES,
      });

      if (!result.ok) {
        // Mislukte login auditen (brute-force-detectie): alleen uitkomst + reden, geen e-mailadres
        // (dat zou enumeratie in het audit-log opleveren). Actor onbekend → geen account/tenant.
        await recordAudit(prisma, request, {
          action: AUDIT_ACTIONS.AUTH_LOGIN,
          outcome: 'failure',
          accountId: null,
          organizationId: null,
          metadata: { reason: result.reason },
        });
        if (result.reason === 'account_locked') {
          throw new HttpError(
            423,
            'ACCOUNT_LOCKED',
            'Account tijdelijk geblokkeerd na te veel mislukte pogingen. Probeer het later opnieuw.',
          );
        }
        // Bewust generiek: geen onderscheid tussen onbekende e-mail en fout wachtwoord.
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Onjuiste e-mail of wachtwoord.');
      }

      // Gedeactiveerde omgeving (T8.3): wachtwoord klopt, maar er komt geen sessie. Bewust ná de
      // wachtwoordcontrole, zodat de melding niet verklapt welke adressen bij een gestopte
      // organisatie horen — je moet de inloggegevens al kennen om hem te zien.
      if (!(await isOrganizationActive(prisma, result.account.organizationId))) {
        await recordAudit(prisma, request, {
          action: AUDIT_ACTIONS.AUTH_LOGIN,
          outcome: 'failure',
          accountId: result.account.id,
          organizationId: result.account.organizationId,
          metadata: { reason: 'organization_suspended' },
        });
        throw new HttpError(403, 'ORGANIZATION_SUSPENDED', ORGANIZATION_SUSPENDED_MESSAGE);
      }

      const { token } = await createSession(prisma, result.account.id, env.SESSION_TTL_HOURS);
      reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(env, sessionMaxAgeSeconds));

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.AUTH_LOGIN,
        outcome: 'success',
        accountId: result.account.id,
        organizationId: result.account.organizationId,
      });

      return { account: toPublic(result.account) };
    },
  );

  app.post(
    '/auth/register',
    {
      config: {
        rateLimit: {
          max: env.REGISTER_RATE_LIMIT_MAX,
          timeWindow: env.REGISTER_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
        },
      },
    },
    async (request, reply): Promise<AuthResponse> => {
      const input = registerRequestSchema.parse(request.body);

      const result = await registerOrganization(prisma, input);

      if (!result.ok) {
        // Bewust generiek: geen bevestiging dat de e-mail al bestaat (geen account-enumeratie).
        // Volledige non-enumeratie (neutrale "check je mail"-respons) komt met de
        // e-mailverificatie in T1.4; tot dan houden we de melding neutraal.
        throw new HttpError(
          409,
          'REGISTRATION_FAILED',
          'Registratie kon niet worden voltooid. Controleer je gegevens of log in.',
        );
      }

      // Meteen ingelogd na registratie (zelfde sessiemechanisme als login, T1.1).
      const { token } = await createSession(prisma, result.account.id, env.SESSION_TTL_HOURS);
      reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(env, sessionMaxAgeSeconds));

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.AUTH_REGISTER,
        accountId: result.account.id,
        organizationId: result.account.organizationId,
        targetType: 'organization',
        targetId: result.account.organizationId,
      });

      // Verificatiemail versturen (T1.4). Bewust best-effort: een falende mailserver mag de
      // registratie niet laten mislukken — de gebruiker is al ingelogd en kan later "opnieuw
      // versturen". Fouten loggen we, maar gooien we niet door.
      try {
        await sendVerificationEmail(prisma, mail, env, result.account);
      } catch (error) {
        request.log.error({ err: error }, 'Verificatiemail versturen mislukt bij registratie');
      }

      reply.status(201);
      return { account: toPublic(result.account) };
    },
  );

  // --- E-mailverificatie (T1.4) ---

  // Token inwisselen. Zowel POST (web-app) als GET (directe link) — beide via dezelfde logica.
  // Ongeldig/verlopen/gebruikt token → 400 met neutrale melding (geen enumeratie).
  const verifyEmailHandler = async (
    source: unknown,
    reply: FastifyReply,
  ): Promise<VerifyEmailResponse> => {
    const { token } = verifyEmailRequestSchema.parse(source);
    const result = await verifyEmailToken(prisma, token);
    if (!result.ok) {
      throw new HttpError(
        400,
        'INVALID_VERIFICATION_TOKEN',
        'Deze verificatielink is ongeldig of verlopen. Vraag een nieuwe aan.',
      );
    }
    await recordAudit(prisma, reply.request, {
      action: AUDIT_ACTIONS.AUTH_EMAIL_VERIFIED,
      accountId: result.account.id,
      organizationId: result.account.organizationId,
      targetType: 'account',
      targetId: result.account.id,
    });
    reply.status(200);
    return { verified: true, account: toPublic(result.account) };
  };

  app.post('/auth/verify-email', (request, reply) => verifyEmailHandler(request.body, reply));
  app.get('/auth/verify-email', (request, reply) => verifyEmailHandler(request.query, reply));

  // Opnieuw versturen. Publiek, streng rate-limited, en **altijd** een neutrale respons: of het
  // adres nu bestaat, al geverifieerd is, of onbekend — de client leert niets (geen enumeratie).
  app.post(
    '/auth/verify-email/resend',
    {
      config: {
        rateLimit: {
          max: env.RESEND_RATE_LIMIT_MAX,
          timeWindow: env.RESEND_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
        },
      },
    },
    async (request): Promise<ResendVerificationResponse> => {
      const { email } = resendVerificationRequestSchema.parse(request.body);

      // Alleen versturen als er een nog niet geverifieerd account bij dit adres hoort. Alle
      // andere gevallen leiden tot dezelfde neutrale respons zonder iets te doen.
      const account = await prisma.account.findUnique({ where: { email } });
      if (account && account.emailVerifiedAt === null) {
        try {
          await sendVerificationEmail(prisma, mail, env, account);
        } catch (error) {
          request.log.error({ err: error }, 'Verificatiemail opnieuw versturen mislukt');
        }
      }

      return { message: RESEND_NEUTRAL_MESSAGE };
    },
  );

  // --- Eigen wachtwoord wijzigen (T2.5) ---

  // Elk **ingelogd** account wisselt hier zijn eigen wachtwoord. Het account komt uit de sessie,
  // nooit uit de body: er is geen manier om via deze route het wachtwoord van een ander te zetten.
  // Rate-limited (elke poging kost een argon2-verificatie en raadt effectief het huidige
  // wachtwoord) en de overige sessies van dit account worden bij succes ingetrokken.
  app.post(
    '/auth/password',
    {
      // `allowPendingPasswordChange` (T2.6): juist een account dat nog op zijn tijdelijke
      // wachtwoord zit moet hier terechtkunnen — dit is de enige uitweg uit die gate.
      preHandler: authorize(prisma, { allowPendingPasswordChange: true }),
      config: {
        rateLimit: {
          max: env.PASSWORD_CHANGE_RATE_LIMIT_MAX,
          timeWindow: env.PASSWORD_CHANGE_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
        },
      },
    },
    async (request): Promise<ChangePasswordResponse> => {
      const account = requireAccount(request);
      const input = changePasswordRequestSchema.parse(request.body);

      const result = await changeOwnPassword(prisma, account, input, readSessionToken(request));

      if (!result.ok) {
        // Mislukte poging auditen: een reeks hiervan op een ingelogde sessie is een signaal.
        await recordAudit(prisma, request, {
          action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE,
          outcome: 'failure',
          targetType: 'account',
          targetId: account.id,
          metadata: { reason: result.reason },
        });
        // Hier mág de melding wél concreet zijn (anders dan bij login): de aanroeper is al
        // geauthenticeerd als dít account, dus "je huidige wachtwoord klopt niet" vertelt hem
        // niets wat hij niet al weet — er valt geen ander account mee te enumereren.
        throw new HttpError(401, 'INVALID_CURRENT_PASSWORD', 'Het huidige wachtwoord klopt niet.');
      }

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE,
        targetType: 'account',
        targetId: account.id,
        // Alleen het aantal ingetrokken sessies als context — nooit het wachtwoord of de hash.
        metadata: { revokedSessions: result.revokedSessions },
      });

      return changePasswordResponseSchema.parse({ revokedSessions: result.revokedSessions });
    },
  );

  app.post('/auth/logout', async (request, reply): Promise<void> => {
    const token = readSessionToken(request);
    if (token) {
      // Actor bepalen vóór het verwijderen van de sessie, zodat het audit-spoor de uitlogger kent.
      const account = await findAccountBySessionToken(prisma, token);
      await deleteSessionByToken(prisma, token);
      if (account) {
        await recordAudit(prisma, request, {
          action: AUDIT_ACTIONS.AUTH_LOGOUT,
          accountId: account.id,
          organizationId: account.organizationId,
        });
      }
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    reply.status(204).send();
  });

  // Elk ingelogd account mag zijn eigen gegevens opvragen; de authorize()-preHandler
  // handelt de 401 af en zet het geverifieerde account op de request. Ook toegestaan met een nog
  // niet vervangen tijdelijk wachtwoord (T2.6): de web-UI leest hier `mustChangePassword` om de
  // houder naar het wachtwoordscherm te sturen — zonder dit antwoord weet hij niet waaróm de rest
  // dichtzit.
  app.get(
    '/auth/me',
    { preHandler: authorize(prisma, { allowPendingPasswordChange: true }) },
    (request): AuthResponse => {
      return { account: toPublic(requireAccount(request)) };
    },
  );
}
