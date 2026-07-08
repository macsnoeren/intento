import type { FastifyRequest } from 'fastify';
import { SESSION_COOKIE_NAME } from './cookie.js';

/**
 * Leest en valideert het rauwe sessietoken uit de ondertekende sessie-cookie.
 * Geeft `null` als de cookie ontbreekt of de handtekening niet klopt (geknoeid).
 * De aanroeper zet dit token vervolgens om naar een account via `findAccountBySessionToken`.
 */
export function readSessionToken(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE_NAME];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : null;
}
