import { PROFILE_EXPORT_VERSION, profileExportSchema, type ProfileExport } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import type { Encryptor } from '../crypto/encryption.js';
import { HttpError } from '../errors.js';
import { DEFAULT_PROFILE, profileFromModel, type UserWithProfile } from './serialize.js';

/**
 * Profielexport en -import (INTENTO-NEW-DESIGN §1 eigenaarschap, §53).
 *
 * De gebruiker bezit zijn profiel en kan het meenemen naar een andere omgeving. Deze module is bewust HTTP-vrij zodat de bouw/versleuteling en het inlezen/valideren
 * deterministisch te testen zijn; de routes (`routes/profile-transfer.ts`) doen de auth/tenant-grens.
 *
 * Wat reist er mee: de communicatie-instellingen en de weergavenaam (contacten en Experience volgen in
 * N15.1). **Niet**: account- of organisatiegegevens, id's of tokens (omgeving-specifiek). Het exportbestand wordt in zijn geheel
 * versleuteld met de omgevingssleutel (`ENCRYPTION_KEY`) en is dus onleesbaar zonder die sleutel.
 *
 * Sleutel-let op: de versleuteling gebruikt dezelfde `ENCRYPTION_KEY` als de rest van de app. Een export
 * importeren in een **andere** deployment kan daarom alleen als die deployment dezelfde sleutel deelt
 * (MVP-keuze; een wachtwoordgebaseerde exportsleutel is toekomstig werk — zie docs/security.md).
 */

/** Bouwt de ontsleutelde export-payload voor één gebruiker (caller heeft tenant/bestaan al bewaakt). */
export async function buildProfileExport(
  prisma: PrismaClient,
  encryptor: Encryptor,
  userId: string,
): Promise<ProfileExport> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { communicationProfile: true },
  });

  const profile = user.communicationProfile;
  // `profileExportSchema.parse` dwingt meteen af dat de payload klopt en dat er geen extra velden lekken
  // die niet in het draagbare profiel horen.
  return profileExportSchema.parse({
    version: PROFILE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    user: { name: user.name },
    // Het hele profiel verhuist mee, ook de stem: hoe iemand klinkt hoort bij zijn profiel.
    communicationProfile: profile ? profileFromModel(profile) : DEFAULT_PROFILE,
  });
}

/** Versleutelt de export-payload tot de ondoorzichtige bestand-string (onleesbaar zonder sleutel). */
export function encryptProfileExport(encryptor: Encryptor, payload: ProfileExport): string {
  return encryptor.encrypt(JSON.stringify(payload));
}

/**
 * Leest een versleutelde export-string in tot een gevalideerde payload. Elke stap die op ongeldige/geknoeide
 * invoer kan stuiten (ontsleutelen, JSON-parse) mapt naar een nette 400 `IMPORT_INVALID` — nooit een 500,
 * en zonder interne details te lekken. Een schema-mismatch (verkeerd formaat/versie) laat de `ZodError`
 * door naar de centrale handler (ook 400).
 */
export function decodeProfileExport(encryptor: Encryptor, data: string): ProfileExport {
  let json: string;
  try {
    json = encryptor.decrypt(data);
  } catch {
    throw new HttpError(
      400,
      'IMPORT_INVALID',
      'Het exportbestand kon niet worden gelezen (ongeldig of met een andere sleutel gemaakt).',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new HttpError(400, 'IMPORT_INVALID', 'Het exportbestand is beschadigd.');
  }
  return profileExportSchema.parse(parsed);
}

/**
 * Importeert een profiel als **nieuwe** gebruiker in de organisatie van het account: de gebruiker met
 * zijn communicatieprofiel. `nameOverride` vervangt optioneel de geëxporteerde weergavenaam.
 */
export async function importProfile(
  prisma: PrismaClient,
  encryptor: Encryptor,
  account: AccountModel,
  data: string,
  nameOverride?: string,
): Promise<UserWithProfile> {
  const payload = decodeProfileExport(encryptor, data);
  const name = nameOverride ?? payload.user.name;

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        organizationId: account.organizationId,
        communicationProfile: { create: { ...payload.communicationProfile } },
      },
    });

    return tx.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { communicationProfile: true },
    });
  });
}
