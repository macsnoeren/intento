import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { DeviceModel } from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { DEVICE_COOKIE_NAME } from './cookie.js';

/**
 * Apparaatkoppeling en device-auth (T2.3, DESIGN §6.2, §8.2, FR-018).
 *
 * Twee geheimen, dezelfde beveiligingsregel als bij sessies (`session.ts`): niets staat
 * plaintext in de db.
 *   - **Koppelcode** — kortlevend, eenmalig, door de beheerder gegenereerd en op de tablet
 *     ingevoerd. We bewaren alleen de SHA-256-hash.
 *   - **Apparaat-token** — langlevend, na inwisselen aan de tablet gegeven als httpOnly+Secure
 *     cookie; alleen de SHA-256-hash staat in de db. Het token geeft **alléén** toegang tot de
 *     eigen-gebruiker-endpoints (device-scope), nooit tot beheer- of accountroutes.
 *
 * SHA-256 (i.p.v. argon2) volstaat: het token is 256 bit random en de code heeft genoeg
 * entropie + korte levensduur + eenmalig gebruik + rate limiting — er valt geen zwak
 * wachtwoord te beschermen.
 */

// Module-augmentatie: het geverifieerde apparaat leeft op de request tijdens de handler.
declare module 'fastify' {
  interface FastifyRequest {
    device?: DeviceModel;
  }
}

/**
 * Alfabet voor koppelcodes: hoofdletters/cijfers zónder visueel verwarrende tekens (0/O, 1/I/L).
 * 32 tekens deelt 256 precies (256/32 = 8), dus `byte % 32` is bias-vrij uniform. Bij inwisselen
 * normaliseert de client-invoer al naar dit alfabet (zie `linkDeviceRequestSchema`).
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** SHA-256-hash (hex); dezelfde functie bij aanmaken en opzoeken van code én token. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Genereert een leesbare koppelcode (8 tekens uit een 31-teken alfabet, ~40 bit entropie). */
export function generateLinkCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Genereert een cryptografisch sterk, URL-veilig apparaat-token (256 bit). */
export function generateDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface GeneratedLinkCode {
  code: string;
  expiresAt: Date;
}

/**
 * Maakt een koppelcode voor een gebruiker en geeft de **plaintext** code terug (alleen hier
 * beschikbaar; daarna kennen we alleen de hash). Eventuele nog niet gebruikte codes van dezelfde
 * gebruiker worden eerst verwijderd, zodat er hooguit één geldige code tegelijk bestaat.
 */
export async function createLinkCode(
  prisma: PrismaClient,
  userId: string,
  ttlMinutes: number,
): Promise<GeneratedLinkCode> {
  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  await prisma.deviceLinkCode.deleteMany({ where: { userId, usedAt: null } });
  await prisma.deviceLinkCode.create({
    data: { codeHash: sha256(code), userId, expiresAt },
  });
  return { code, expiresAt };
}

export interface LinkedDevice {
  device: DeviceModel;
  token: string;
}

/**
 * Wisselt een (genormaliseerde) koppelcode in voor een nieuw apparaat-token. Weigert met `null`
 * als de code onbekend, verlopen of al gebruikt is. Eenmalig gebruik wordt race-veilig bewaakt:
 * we markeren de code alleen als die nog ongebruikt is (`updateMany ... usedAt: null`) en gaan
 * pas verder als die update precies één rij raakte. Het rauwe token wordt alleen hier
 * teruggegeven; daarna kennen we alleen de hash.
 */
export async function linkDeviceByCode(
  prisma: PrismaClient,
  code: string,
  deviceType: string,
): Promise<LinkedDevice | null> {
  const record = await prisma.deviceLinkCode.findUnique({ where: { codeHash: sha256(code) } });
  if (!record) return null;

  // Verlopen of al gebruikt: weigeren. Een verlopen code ruimen we meteen op.
  if (record.usedAt !== null) return null;
  if (record.expiresAt.getTime() <= Date.now()) {
    await prisma.deviceLinkCode.delete({ where: { id: record.id } }).catch(() => undefined);
    return null;
  }

  // Atomair claimen: alleen als de code nog ongebruikt is. Voorkomt dubbel inwisselen bij een race.
  const claimed = await prisma.deviceLinkCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;

  const token = generateDeviceToken();
  const device = await prisma.device.create({
    data: { userId: record.userId, type: deviceType, tokenHash: sha256(token) },
  });
  return { device, token };
}

/**
 * Zoekt het apparaat bij een rauw token en werkt `lastActive` bij. Geeft `null` als het token
 * onbekend is. Er is geen verlooptijd op het token zelf; intrekken gebeurt door het `Device` te
 * verwijderen (o.a. cascade bij het verwijderen van de gebruiker).
 */
export async function findDeviceByToken(
  prisma: PrismaClient,
  token: string,
): Promise<DeviceModel | null> {
  const device = await prisma.device.findUnique({ where: { tokenHash: sha256(token) } });
  if (!device) return null;
  // Best-effort: bijwerken van lastActive mag de request nooit laten falen.
  await prisma.device
    .update({ where: { id: device.id }, data: { lastActive: new Date() } })
    .catch(() => undefined);
  return device;
}

/**
 * Leest het rauwe apparaat-token uit de ondertekende device-cookie. Geeft `null` als de cookie
 * ontbreekt of de handtekening niet klopt (geknoeid).
 */
export function readDeviceToken(request: FastifyRequest): string | null {
  const raw = request.cookies[DEVICE_COOKIE_NAME];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : null;
}

/**
 * Bouwt een preHandler dat device-authenticatie afdwingt: apparaat-token uit de cookie omzetten
 * naar een `Device`; ontbreekt dat (of is de cookie geknoeid), dan 401. Bij succes staat het
 * geverifieerde apparaat op `request.device`. Dit is een **aparte** authenticatiepijler naast
 * `authorize` (accounts): een device-token werkt niet op accountroutes en omgekeerd.
 */
export function deviceAuthorize(prisma: PrismaClient): preHandlerAsyncHookHandler {
  return async (request) => {
    const token = readDeviceToken(request);
    const device = token ? await findDeviceByToken(prisma, token) : null;
    if (!device) {
      throw new HttpError(401, 'DEVICE_NOT_LINKED', 'Geen gekoppeld apparaat.');
    }
    request.device = device;
  };
}

/**
 * Haalt het geverifieerde apparaat op dat `deviceAuthorize` op de request zette. Faalt hard
 * (500) als het ontbreekt: dat betekent een programmeerfout — de route mist zijn preHandler.
 */
export function requireDevice(request: FastifyRequest): DeviceModel {
  if (!request.device) {
    throw new HttpError(
      500,
      'INTERNAL_ERROR',
      'Route mist de deviceAuthorize()-preHandler; geen geverifieerd apparaat beschikbaar.',
    );
  }
  return request.device;
}
