import {
  PROFILE_EXPORT_VERSION,
  profileExportSchema,
  toConversationStrategy,
  type ProfileExport,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import type { Encryptor } from '../crypto/encryption.js';
import { HttpError } from '../errors.js';
import { DEFAULT_PROFILE, type UserWithProfile } from './serialize.js';

/**
 * Profielexport en -import (T8.1, DESIGN §6.4, §8.2, FR-019).
 *
 * Kern van gegevenseigenaarschap (DESIGN §4): de gebruiker bezit zijn profiel en kan het meenemen naar een
 * andere omgeving. Deze module is bewust HTTP-vrij zodat de bouw/versleuteling en het inlezen/valideren
 * deterministisch te testen zijn; de routes (`routes/profile-transfer.ts`) doen de auth/tenant-grens.
 *
 * Wat reist er mee (DESIGN §6.4): communicatie-instellingen, persoonlijke context (versleuteld at-rest,
 * hier ontsleuteld voor de export) en geleerde voorkeuren — plus de weergavenaam. **Niet**: account- of
 * organisatiegegevens, id's of tokens (omgeving-specifiek). Het exportbestand wordt in zijn geheel
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

  const contexts = await prisma.personalContext.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });

  const preferences = await prisma.preference.findMany({
    where: { userId },
    orderBy: [{ confidence: 'desc' }, { count: 'desc' }, { concept: 'asc' }],
  });

  const profile = user.communicationProfile;
  // `profileExportSchema.parse` dwingt meteen af dat de payload klopt (bv. alléén 2/4/6/8 iconen) en dat er
  // geen extra velden lekken die niet in het draagbare profiel horen.
  return profileExportSchema.parse({
    version: PROFILE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    user: { name: user.name },
    communicationProfile: profile
      ? {
          iconsPerScreen: profile.iconsPerScreen,
          showText: profile.showText,
          aiLearningEnabled: profile.aiLearningEnabled,
          supportMode: profile.supportMode,
          contextIndicator: profile.contextIndicator,
          conversationStrategy: toConversationStrategy(profile.conversationStrategy),
        }
      : DEFAULT_PROFILE,
    // De categorie/suggestionStatus komen als `String` uit de db; `profileExportSchema.parse` hieronder
    // valideert ze tegen de gesloten taxonomieën (en weigert een onbekende waarde met een 400).
    personalContexts: contexts.map((row) => ({
      category: row.category,
      name: encryptor.decrypt(row.nameEncrypted),
      relationship:
        row.relationshipEncrypted !== null ? encryptor.decrypt(row.relationshipEncrypted) : null,
      aiUsageAllowed: row.aiUsageAllowed,
    })),
    preferences: preferences.map((pref) => ({
      concept: pref.concept,
      confidence: pref.confidence,
      count: pref.count,
      source: pref.source,
      suggestionStatus: pref.suggestionStatus,
    })),
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
 * Importeert een profiel als **nieuwe** gebruiker in de organisatie van het account. In één transactie: de
 * gebruiker + communicatieprofiel, de persoonlijke context (opnieuw **versleuteld** at-rest) en de geleerde
 * voorkeuren. `nameOverride` vervangt optioneel de geëxporteerde weergavenaam.
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

    if (payload.personalContexts.length > 0) {
      await tx.personalContext.createMany({
        data: payload.personalContexts.map((ctx) => ({
          userId: user.id,
          category: ctx.category,
          nameEncrypted: encryptor.encrypt(ctx.name),
          relationshipEncrypted:
            ctx.relationship !== null ? encryptor.encrypt(ctx.relationship) : null,
          aiUsageAllowed: ctx.aiUsageAllowed,
        })),
      });
    }

    if (payload.preferences.length > 0) {
      await tx.preference.createMany({
        data: payload.preferences.map((pref) => ({
          userId: user.id,
          concept: pref.concept,
          confidence: pref.confidence,
          count: pref.count,
          source: pref.source,
          suggestionStatus: pref.suggestionStatus,
        })),
      });
    }

    return tx.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { communicationProfile: true },
    });
  });
}
