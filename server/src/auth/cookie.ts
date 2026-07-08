import type { CookieSerializeOptions } from '@fastify/cookie';
import type { Env } from '../env.js';

/**
 * Cookie-instellingen voor het sessietoken (DESIGN §9.4, CLAUDE.md security-checklist).
 *
 * - `httpOnly`: niet leesbaar vanuit JS → beschermt tegen token-diefstal via XSS.
 * - `secure`: alleen over HTTPS (verplicht in productie via de env-prod-guard).
 * - `sameSite: 'lax'`: mitigeert CSRF terwijl normale navigatie blijft werken.
 * - `signed`: HMAC met `SIGNING_SECRET` — een geknoeide cookie wordt geweigerd.
 */
export const SESSION_COOKIE_NAME = 'intento_session';

export function sessionCookieOptions(env: Env, maxAgeSeconds: number): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    signed: true,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
