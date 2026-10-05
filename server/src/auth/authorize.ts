import type { FastifyRequest, preHandlerAsyncHookHandler, preHandlerHookHandler } from 'fastify';
import type { AccountRole } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { findAccountBySessionToken } from './session.js';
import { readSessionToken } from './request.js';
import { assertOrganizationActive } from './organization-status.js';

/**
 * Autorisatie-middleware (INTENTO-NEW-DESIGN §49, §53).
 *
 * Elke beschermde route hangt hetzelfde `authorize(...)`-preHandler ervoor. Dat doet drie
 * dingen, in deze volgorde:
 *   1. **Authenticatie** — sessietoken uit de cookie omzetten naar een account; ontbreekt
 *      dat (of is de sessie verlopen/geknoeid), dan 401.
 *   2. **Rolcontrole** — als de route rollen opgeeft en de rol van het account zit er niet
 *      bij, dan 403 (met de consistente foutstructuur uit INTENTO-NEW-DESIGN §51).
 *   3. **Tijdelijk-wachtwoord-gate** — draait het account nog op het wachtwoord dat de
 *      server bij het aanmaken genereerde en aan de beheerder toonde (`mustChangePassword`), dan
 *      403 `PASSWORD_CHANGE_REQUIRED`, behalve op de routes die expliciet
 *      `allowPendingPasswordChange` zetten (`GET /auth/me`, `POST /auth/password`).
 *   4. **Organisatiestatus** — is de organisatie door een platform-operator gedeactiveerd,
 *      dan 403 `ORGANIZATION_SUSPENDED`. Bewust hier en niet alleen bij login: zo stopt een
 *      lopende sessie meteen in plaats van pas als hij verloopt (zie `organization-status.ts`).
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
  /**
   * Laat een account met een nog niet vervangen **tijdelijk** wachtwoord door. Bewust
   * andersom dan de verificatie-gate van T1.4: die is een opt-in guard op een handvol gevoelige
   * routes (`requireVerifiedEmail`), deze is **default-deny** met een opt-out op precies twee
   * routes. Reden voor het verschil: een onbevestigd e-mailadres is een onbewezen adres, maar een
   * tijdelijk wachtwoord is een **levend, gedeeld** wachtwoord — tot het vervangen is, kan de
   * beheerder alles doen wat de houder kan. Default-deny betekent bovendien dat een nieuwe route
   * automatisch achter de gate staat in plaats van hem per ongeluk te missen (fail-safe).
   */
  allowPendingPasswordChange?: boolean;
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
  const allowPendingPasswordChange = options.allowPendingPasswordChange ?? false;
  return async (request) => {
    const token = readSessionToken(request);
    const account = token ? await findAccountBySessionToken(prisma, token) : null;
    if (!account) {
      throw new HttpError(401, 'NOT_AUTHENTICATED', 'Niet ingelogd.');
    }
    if (roles && !roles.includes(account.role as AccountRole)) {
      throw new HttpError(403, 'FORBIDDEN', 'Je hebt geen toegang tot deze actie.');
    }
    if (account.mustChangePassword && !allowPendingPasswordChange) {
      throw new HttpError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Kies eerst zelf een wachtwoord; je tijdelijke wachtwoord is ook bij je beheerder bekend.',
      );
    }
    // Gedeactiveerde omgeving: ook een geldige sessie komt er niet meer in.
    await assertOrganizationActive(prisma, account.organizationId);
    request.account = account;
  };
}

/**
 * Extra preHandler dat een **geverifieerd e-mailadres** eist. Hangt ná `authorize(...)`
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
 * Extra preHandler dat een **platformbeheerder** eist. Hangt ná `authorize(prisma, { roles: ['ADMIN'] })`
 * en geeft 403 `NOT_PLATFORM_ADMIN` als de organisatie van het account geen platform-org is
 * (`Organization.isPlatform`). Bedoeld voor wat het hele platform raakt, zoals de platformitems van de
 * Vocabulary (INTENTO-NEW-DESIGN §15): een zelf-aangemelde organisatie mag die niet wijzigen.
 */
export function requirePlatformOrg(prisma: PrismaClient): preHandlerAsyncHookHandler {
  return async (request) => {
    const account = requireAccount(request);
    const org = await prisma.organization.findUnique({
      where: { id: account.organizationId },
      select: { isPlatform: true },
    });
    if (!org?.isPlatform) {
      throw new HttpError(403, 'NOT_PLATFORM_ADMIN', 'Alleen een platformbeheerder mag dit.');
    }
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
