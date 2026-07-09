import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  loginRequestSchema,
  registerRequestSchema,
  resendVerificationRequestSchema,
  verifyEmailRequestSchema,
  type AuthResponse,
  type ResendVerificationResponse,
  type VerifyEmailResponse,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { verifyLogin } from '../auth/service.js';
import { registerOrganization } from '../auth/register.js';
import { createSession, deleteSessionByToken } from '../auth/session.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '../auth/cookie.js';
import { readSessionToken } from '../auth/request.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { accountToPublic as toPublic } from '../auth/serialize.js';
import { sendVerificationEmail, verifyEmailToken } from '../auth/email-verification.js';
import type { MailTransport } from '../mail/transport.js';

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

      const { token } = await createSession(prisma, result.account.id, env.SESSION_TTL_HOURS);
      reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(env, sessionMaxAgeSeconds));

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

  app.post('/auth/logout', async (request, reply): Promise<void> => {
    const token = readSessionToken(request);
    if (token) await deleteSessionByToken(prisma, token);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    reply.status(204).send();
  });

  // Elk ingelogd account mag zijn eigen gegevens opvragen; de authorize()-preHandler
  // handelt de 401 af en zet het geverifieerde account op de request.
  app.get('/auth/me', { preHandler: authorize(prisma) }, (request): AuthResponse => {
    return { account: toPublic(requireAccount(request)) };
  });
}
