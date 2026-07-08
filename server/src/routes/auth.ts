import type { FastifyInstance } from 'fastify';
import {
  accountPublicSchema,
  loginRequestSchema,
  type AuthResponse,
  type AccountPublic,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { verifyLogin } from '../auth/service.js';
import { createSession, deleteSessionByToken } from '../auth/session.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '../auth/cookie.js';
import { readSessionToken } from '../auth/request.js';
import { authorize, requireAccount } from '../auth/authorize.js';

export interface AuthRoutesDeps {
  env: Env;
  prisma: PrismaClient;
}

/** Mapt een account naar de publieke, veilige weergave (nooit hash of lockout-velden). */
function toPublic(account: AccountModel): AccountPublic {
  return accountPublicSchema.parse({
    id: account.id,
    email: account.email,
    role: account.role,
    organizationId: account.organizationId,
  });
}

/**
 * Auth-routes (T1.1, DESIGN §8.2): login, logout en het opvragen van het eigen account.
 *
 * Login is streng rate-limited (per IP) én kent account-lockout; sessietokens gaan als
 * ondertekende httpOnly+Secure cookie mee en staan alleen gehasht in de db.
 */
export function registerAuthRoutes(app: FastifyInstance, { env, prisma }: AuthRoutesDeps): void {
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
