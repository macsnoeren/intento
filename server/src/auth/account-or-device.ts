import type { preHandlerAsyncHookHandler } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { findAccountBySessionToken } from './session.js';
import { readSessionToken } from './request.js';
import { findDeviceByToken, readDeviceToken } from './device.js';

/**
 * Toegangsguard voor **gedeelde, niet-tenant-gebonden app-data**: een ingelogd account óf een
 * gekoppeld apparaat mag erbij (T3.1, uitgebreid in T9.4/T9.7).
 *
 * Gebruikt door de AAC-bibliotheek (`/aac/search`, `/aac/topics`) en de AI-status (`/ai/status`): dat
 * zijn geen persoonsgegevens, maar bewust ook niet publiek — alleen geauthenticeerde clients (beheer-UI,
 * begeleider) én de tablet (device-token, nodig tijdens communicatie) komen erbij. Zonder een van beide: 401.
 *
 * Bewust géén tenant-filtering hier: de routes erachter mogen **alleen** organisatie-onafhankelijke data
 * teruggeven. Alles wat aan een gebruiker of organisatie hangt, hoort achter `authorize` + `tenantScope`.
 */
export function authorizeAccountOrDevice(prisma: PrismaClient): preHandlerAsyncHookHandler {
  return async (request) => {
    const sessionToken = readSessionToken(request);
    if (sessionToken && (await findAccountBySessionToken(prisma, sessionToken))) return;

    const deviceToken = readDeviceToken(request);
    if (deviceToken && (await findDeviceByToken(prisma, deviceToken))) return;

    throw new HttpError(401, 'NOT_AUTHENTICATED', 'Niet ingelogd.');
  };
}
