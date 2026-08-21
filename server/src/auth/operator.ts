import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { findAccountBySessionToken } from './session.js';
import { readSessionToken } from './request.js';

/**
 * Guard voor de **platform-operatorconsole** (T8.3, DESIGN §9.1, §9.4, ADR-0011).
 *
 * De operatorconsole is de enige plek in Intento die bewust **door de tenant-grens heen kijkt**:
 * organisaties en accounts van álle omgevingen naast elkaar, om een omgeving aan te maken of een
 * misbruikte omgeving te stoppen. Dat staat lijnrecht tegenover het isolatieprincipe uit T1.2, dus
 * de doorbreking is hier zo klein en zo zichtbaar mogelijk gemaakt:
 *
 * 1. **Eigen guard, eigen routetak.** Operator-routes hangen achter `operatorAuthorize(...)` en
 *    leven onder `/operator/*` (zie `routes/operator.ts`). Ze delen géén preHandler met de
 *    tenant-routes; een wijziging aan `authorize()` kan dus nooit per ongeluk cross-tenant lezen
 *    ontgrendelen, en andersom.
 * 2. **`request.operator`, nooit `request.account`.** Dit is de kern van de scheiding en bewust
 *    geen stijlkeuze: de tenant-helpers (`requireAccount`, en daarmee `tenantScope`/
 *    `assertSameTenant`) lezen `request.account`. Door die leeg te laten faalt een tenant-helper op
 *    een operator-route hard (500 "route mist de authorize()-preHandler") in plaats van stilletjes
 *    op de organisatie van de operator te filteren — en omgekeerd kan een handler die `requireOperator`
 *    gebruikt nooit op een gewone route belanden. De vergissing wordt een crash, geen datalek.
 * 3. **Dubbele voorwaarde.** Het account moet `isOperator` hebben **én** in een organisatie met
 *    `isPlatform=true` zitten. Eén vlag alleen is niet genoeg: een gekopieerde/geïmporteerde rij of
 *    een verkeerd gezette vlag in een gewone tenant levert zo nog steeds geen console-toegang.
 * 4. **Dezelfde accountgates als elders.** Een tijdelijk wachtwoord (T2.6) of een onbevestigd
 *    e-mailadres (T1.4) blokkeert ook hier — juist hier, want dit is het krachtigste account van het
 *    platform. Bewust letterlijk herhaald in plaats van hergebruikt: deze guard moet los te lezen en
 *    los te reviewen zijn.
 *
 * De operatorrol wordt **nooit via een API uitgedeeld**; alleen de bootstrap-seed zet `isOperator`
 * (zie `db/bootstrap-seed.ts`). Er is dus geen weg waarlangs een tenant-ADMIN zichzelf of een ander
 * account naar de console kan promoveren.
 */

// Module-augmentatie: de geverifieerde operator leeft op de request tijdens de handler —
// bewust op een ánder veld dan `account` (zie punt 2 hierboven).
declare module 'fastify' {
  interface FastifyRequest {
    operator?: AccountModel;
  }
}

/**
 * Bouwt het preHandler dat operator-toegang afdwingt: 401 zonder sessie, 403 `NOT_OPERATOR` voor elk
 * ander account (ook een gewone ADMIN of een niet-operator in de platformorganisatie). Bij succes
 * staat het account op `request.operator`.
 *
 * `NOT_OPERATOR` is één foutcode voor "geen operatorvlag" én "niet in de platformorganisatie": het
 * onderscheid zou alleen verklappen hoe dicht een aanvaller bij de console zit.
 */
export function operatorAuthorize(prisma: PrismaClient): preHandlerAsyncHookHandler {
  return async (request) => {
    const token = readSessionToken(request);
    const account = token ? await findAccountBySessionToken(prisma, token) : null;
    if (!account) {
      throw new HttpError(401, 'NOT_AUTHENTICATED', 'Niet ingelogd.');
    }
    if (!account.isOperator) {
      throw new HttpError(403, 'NOT_OPERATOR', 'Alleen een platformbeheerder heeft hier toegang.');
    }
    // Tijdelijk wachtwoord: tot de houder zelf een wachtwoord koos kent een tweede persoon het (T2.6).
    if (account.mustChangePassword) {
      throw new HttpError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Kies eerst zelf een wachtwoord; je tijdelijke wachtwoord is ook bij je beheerder bekend.',
      );
    }
    if (account.emailVerifiedAt === null) {
      throw new HttpError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Bevestig eerst je e-mailadres om deze actie uit te voeren.',
      );
    }
    const organization = await prisma.organization.findUnique({
      where: { id: account.organizationId },
      select: { isPlatform: true },
    });
    if (!organization?.isPlatform) {
      throw new HttpError(403, 'NOT_OPERATOR', 'Alleen een platformbeheerder heeft hier toegang.');
    }
    request.operator = account;
  };
}

/**
 * Haalt de geverifieerde operator op die `operatorAuthorize` op de request zette. Faalt hard (500)
 * als die ontbreekt: dat betekent een programmeerfout — de route mist zijn preHandler, en zou dan
 * ongeautoriseerd cross-tenant data teruggeven.
 */
export function requireOperator(request: FastifyRequest): AccountModel {
  if (!request.operator) {
    throw new HttpError(
      500,
      'INTERNAL_ERROR',
      'Route mist de operatorAuthorize()-preHandler; geen geverifieerde operator beschikbaar.',
    );
  }
  return request.operator;
}
