import type { FastifyRequest, preHandlerAsyncHookHandler, preHandlerHookHandler } from 'fastify';
import type { AccountRole } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { findAccountBySessionToken } from './session.js';
import { readSessionToken } from './request.js';

/**
 * Autorisatie-middleware (T1.2, DESIGN §2, §9.4).
 *
 * Elke beschermde route hangt hetzelfde `authorize(...)`-preHandler ervoor. Dat doet twee
 * dingen, in deze volgorde:
 *   1. **Authenticatie** — sessietoken uit de cookie omzetten naar een account; ontbreekt
 *      dat (of is de sessie verlopen/geknoeid), dan 401.
 *   2. **Rolcontrole** — als de route rollen opgeeft en de rol van het account zit er niet
 *      bij, dan 403 (met de consistente foutstructuur uit DESIGN §8.1).
 *
 * Het geverifieerde account wordt op `request.account` gezet, zodat de handler het zonder
 * herhaalde lookup kan gebruiken — inclusief `organizationId` voor tenant-filtering
 * (zie `tenant.ts`). Er is bewust geen impliciete authenticatie: een route is pas beschermd
 * als dit preHandler er expliciet voor hangt.
 */

// Module-augmentatie: het geverifieerde account leeft op de request tijdens de handler.
declare module 'fastify' {
  interface FastifyRequest {
    account?: AccountModel;
  }
}

export interface AuthorizeOptions {
  /** Toegestane rollen. Leeg/weggelaten = elk ingelogd account mag erbij (alleen 401-guard). */
  roles?: readonly AccountRole[];
}

/**
 * Bouwt een preHandler dat authenticatie (401) en optioneel rolcontrole (403) afdwingt en
 * bij succes `request.account` vult.
 */
export function authorize(
  prisma: PrismaClient,
  options: AuthorizeOptions = {},
): preHandlerAsyncHookHandler {
  const roles = options.roles;
  return async (request) => {
    const token = readSessionToken(request);
    const account = token ? await findAccountBySessionToken(prisma, token) : null;
    if (!account) {
      throw new HttpError(401, 'NOT_AUTHENTICATED', 'Niet ingelogd.');
    }
    if (roles && !roles.includes(account.role as AccountRole)) {
      throw new HttpError(403, 'FORBIDDEN', 'Je hebt geen toegang tot deze actie.');
    }
    request.account = account;
  };
}

/**
 * Extra preHandler dat een **geverifieerd e-mailadres** eist (T1.4). Hangt ná `authorize(...)`
 * (die `request.account` vult) en geeft 403 `EMAIL_NOT_VERIFIED` als het account nog niet
 * geverifieerd is. Bewust een aparte, expliciete guard op alléén gevoelige acties: inloggen en
 * de eigen gegevens bekijken mag ongeverifieerd, maar bv. gebruikers (echte personen) aanmaken
 * niet — zie docs/security.md voor de gekozen grens.
 */
export function requireVerifiedEmail(): preHandlerHookHandler {
  return (request, _reply, done) => {
    const account = requireAccount(request);
    if (account.emailVerifiedAt === null) {
      done(
        new HttpError(
          403,
          'EMAIL_NOT_VERIFIED',
          'Bevestig eerst je e-mailadres om deze actie uit te voeren.',
        ),
      );
      return;
    }
    done();
  };
}

/**
 * Haalt het geverifieerde account op dat `authorize(...)` op de request zette. Faalt hard
 * (500) als het ontbreekt: dat betekent een programmeerfout — de route mist zijn preHandler.
 */
export function requireAccount(request: FastifyRequest): AccountModel {
  if (!request.account) {
    throw new HttpError(
      500,
      'INTERNAL_ERROR',
      'Route mist de authorize()-preHandler; geen geverifieerd account beschikbaar.',
    );
  }
  return request.account;
}
