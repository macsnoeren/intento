import { PROFILE_EXPORT_VERSION, profileExportSchema, type ProfileExport } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import type { Encryptor } from '../crypto/encryption.js';
import { HttpError } from '../errors.js';
import { availableTo } from '../vocabulary/repository.js';
import { DEFAULT_PROFILE, profileFromModel, type UserWithProfile } from './serialize.js';

/**
 * Profielexport en -import (INTENTO-NEW-DESIGN §1 eigenaarschap, §53).
 *
 * De gebruiker bezit zijn profiel en kan het meenemen naar een andere omgeving. Deze module is bewust HTTP-vrij zodat de bouw/versleuteling en het inlezen/valideren
 * deterministisch te testen zijn; de routes (`routes/profile-transfer.ts`) doen de auth/tenant-grens.
 *
 * Wat reist er mee: de weergavenaam, de communicatie-instellingen, de contacten en de Experience
 * (N15.1). **Niet**: account- of organisatiegegevens, database-id's, tokens of gesprekken (die horen bij
 * de omgeving en de bewaartermijn). Contacten worden bij het inlezen weer **onbevestigd**: de opt-in geldt
 * per omgeving (N10.2). Een pictogram of een symbool in de Experience vervalt als het in de nieuwe
 * organisatie niet beschikbaar is. Het exportbestand wordt in zijn geheel
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
    include: {
      communicationProfile: true,
      contacts: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      experienceStats: { orderBy: [{ subjectType: 'asc' }, { subjectRef: 'asc' }] },
    },
  });

  const profile = user.communicationProfile;
  // Een lokale sleutel per contact: database-id's horen bij deze omgeving.
  const keys = new Map(user.contacts.map((contact, index) => [contact.id, `c${index + 1}`]));
  // `profileExportSchema.parse` dwingt meteen af dat de payload klopt en dat er geen extra velden lekken
  // die niet in het draagbare profiel horen.
  return profileExportSchema.parse({
    version: PROFILE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    user: { name: user.name },
    // Het hele profiel verhuist mee, ook de stem: hoe iemand klinkt hoort bij zijn profiel.
    communicationProfile: profile ? profileFromModel(profile) : DEFAULT_PROFILE,
    contacts: user.contacts.map((contact) => ({
      key: keys.get(contact.id),
      name: encryptor.decrypt(contact.nameEncrypted),
      relation: contact.relation,
      email: encryptor.decrypt(contact.emailEncrypted),
      vocabularyItemId: contact.vocabularyItemId,
      active: contact.active,
      sortOrder: contact.sortOrder,
    })),
    experience: user.experienceStats.flatMap((stat) => {
      const subjectRef =
        stat.subjectType === 'contact' ? keys.get(stat.subjectRef) : stat.subjectRef;
      if (!subjectRef) return []; // een contact dat er niet meer is
      return [
        {
          subjectType: stat.subjectType,
          subjectRef,
          presented: stat.presented,
          chosen: stat.chosen,
          chosenAtFirstPosition: stat.chosenAtFirstPosition,
          lastUsedAt: stat.lastUsedAt?.toISOString() ?? null,
        },
      ];
    }),
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
 * zijn communicatieprofiel, contacten (onbevestigd) en Experience. `nameOverride` vervangt optioneel de
 * geëxporteerde weergavenaam. Alles in één transactie: een half geïmporteerd profiel bestaat niet.
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

  const organizationId = account.organizationId;
  // Welke Vocabulary-items uit het bestand hier beschikbaar zijn (pictogrammen en symbolen).
  const wanted = [
    ...payload.contacts.flatMap((c) => (c.vocabularyItemId ? [c.vocabularyItemId] : [])),
    ...payload.experience.flatMap((e) => (e.subjectType === 'symbol' ? [e.subjectRef] : [])),
  ];
  const available = new Set(
    (
      await prisma.vocabularyItem.findMany({
        where: { id: { in: wanted }, status: 'approved', ...availableTo(organizationId) },
        select: { id: true },
      })
    ).map((item) => item.id),
  );

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        organizationId,
        communicationProfile: { create: { ...payload.communicationProfile } },
      },
    });
    const contactIds = new Map<string, string>();
    for (const contact of payload.contacts) {
      const created = await tx.contact.create({
        data: {
          userId: user.id,
          organizationId,
          nameEncrypted: encryptor.encrypt(contact.name),
          emailEncrypted: encryptor.encrypt(contact.email),
          relation: contact.relation,
          vocabularyItemId:
            contact.vocabularyItemId && available.has(contact.vocabularyItemId)
              ? contact.vocabularyItemId
              : null,
          active: contact.active,
          sortOrder: contact.sortOrder,
          emailVerifiedAt: null,
        },
      });
      contactIds.set(contact.key, created.id);
    }
    for (const stat of payload.experience) {
      const subjectRef =
        stat.subjectType === 'contact'
          ? contactIds.get(stat.subjectRef)
          : stat.subjectType === 'symbol'
            ? available.has(stat.subjectRef)
              ? stat.subjectRef
              : undefined
            : ['binary', 'multi'].includes(stat.subjectRef)
              ? stat.subjectRef
              : undefined;
      if (!subjectRef) continue;
      await tx.experienceStat.upsert({
        where: {
          userId_subjectType_subjectRef: {
            userId: user.id,
            subjectType: stat.subjectType,
            subjectRef,
          },
        },
        create: {
          userId: user.id,
          organizationId,
          subjectType: stat.subjectType,
          subjectRef,
          presented: stat.presented,
          chosen: stat.chosen,
          chosenAtFirstPosition: stat.chosenAtFirstPosition,
          lastUsedAt: stat.lastUsedAt ? new Date(stat.lastUsedAt) : null,
        },
        update: {},
      });
    }

    return tx.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { communicationProfile: true },
    });
  });
}
