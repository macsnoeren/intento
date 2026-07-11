import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  preferenceListResponseSchema,
  preferencePublicSchema,
  preferenceSuggestionActionSchema,
  type PreferenceListResponse,
  type PreferencePublic,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant } from '../auth/tenant.js';
import { assertCaregiverAccess } from '../auth/caregivers.js';
import type { Encryptor } from '../crypto/encryption.js';
import { HttpError } from '../errors.js';
import {
  contextCategoryForAac,
  listPreferences,
  preferenceToPublic,
} from '../users/preferences.js';

export interface PreferenceRoutesDeps {
  prisma: PrismaClient;
  /** Veldversleuteling at-rest (T6.1): een geaccepteerde suggestie wordt versleuteld als persoonlijke context opgeslagen. */
  encryptor: Encryptor;
}

/** Route-parameter: het gebruikers-id uit het pad. */
const userParamsSchema = z.object({ id: z.string().min(1) });

/** Route-parameters voor het afhandelen van een suggestie (gebruiker + voorkeur-id). */
const suggestionParamsSchema = z.object({
  id: z.string().min(1),
  prefId: z.string().min(1),
});

/**
 * Geleerde voorkeuren en de begeleider-suggestie (T6.3, DESIGN §3.8, §6.2 Preference, §7.1 taak 5, FR-014).
 *
 * De **Learning Engine** zelf leert bij het bevestigen van een boodschap (`/conversation/{id}/confirm`,
 * zie `users/preferences.ts`). Deze routes zijn de **beheerkant**: een begeleider/beheerder bekijkt de
 * voorkeuren van een gekoppelde gebruiker en handelt de suggestie af die ontstaat als een concept vaak
 * gekozen is (DESIGN §3.8: "Wil je toevoegen: favoriete activiteit — wandelen?"). Net als bij de
 * persoonlijke context (T6.1/T6.2):
 *   - tenant-gebonden (`assertSameTenant`) en, voor een CAREGIVER, beperkt tot **gekoppelde** gebruikers
 *     (`assertCaregiverAccess`, T2.2);
 *   - een geaccepteerde suggestie wordt als **versleutelde** persoonlijke context opgeslagen (T6.1).
 *
 * Belangrijk (privacy/domein): deze routes **muteren nooit** de geleerde zekerheid zelf — leren gebeurt
 * uitsluitend uit bevestigde communicatie. Ze bepalen alleen wat er met de *suggestie* gebeurt.
 */
export function registerPreferenceRoutes(
  app: FastifyInstance,
  { prisma, encryptor }: PreferenceRoutesDeps,
): void {
  // Lijst — ADMIN + CAREGIVER (gekoppeld). Voorkeuren van de gebruiker, sterkste eerst, met labels.
  app.get(
    '/users/:id/preferences',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<PreferenceListResponse> => {
      const account = requireAccount(request);
      const { id } = userParamsSchema.parse(request.params);

      const user = await prisma.user.findUnique({ where: { id } });
      assertSameTenant(account, user);
      await assertCaregiverAccess(prisma, account, id);

      return preferenceListResponseSchema.parse({
        preferences: await listPreferences(prisma, id),
      });
    },
  );

  // Suggestie afhandelen — ADMIN + CAREGIVER (gekoppeld). accept/adjust → persoonlijke context aanmaken;
  // reject → suggestie weigeren. In beide gevallen wordt de suggestie afgesloten (niet opnieuw getoond).
  app.post(
    '/users/:id/preferences/:prefId/suggestion',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<PreferencePublic> => {
      const account = requireAccount(request);
      const { id, prefId } = suggestionParamsSchema.parse(request.params);
      const body = preferenceSuggestionActionSchema.parse(request.body);

      const user = await prisma.user.findUnique({ where: { id } });
      assertSameTenant(account, user);
      await assertCaregiverAccess(prisma, account, id);

      // De voorkeur moet bestaan én bij déze gebruiker horen — anders lekt een id van een andere gebruiker.
      const pref = await prisma.preference.findUnique({ where: { id: prefId } });
      if (!pref || pref.userId !== id) {
        throw new HttpError(404, 'PREFERENCE_NOT_FOUND', 'Voorkeur bestaat niet.');
      }
      // Alleen een openstaande suggestie kan worden afgehandeld (idempotent/geen dubbele context).
      if (pref.suggestionStatus !== 'pending') {
        throw new HttpError(409, 'NO_PENDING_SUGGESTION', 'Er staat geen suggestie open voor deze voorkeur.');
      }

      if (body.action === 'reject') {
        const updated = await prisma.preference.update({
          where: { id: prefId },
          data: { suggestionStatus: 'dismissed' },
        });
        return preferenceToPublic(updated, await labelFor(prisma, updated.concept));
      }

      // accept/adjust → de voorkeur overnemen als persoonlijke context. `adjust` gebruikt de door de
      // begeleider aangepaste categorie/naam; `accept` een sensibele standaard (categorie afgeleid uit het
      // AAC-concept, naam = het label). De gevoelige velden worden versleuteld opgeslagen (T6.1).
      const symbol = await prisma.aacSymbol.findUnique({ where: { concept: pref.concept } });
      const label = symbol?.label ?? pref.concept;
      const category = body.category ?? contextCategoryForAac(symbol?.category ?? null);
      const name = body.name ?? label;

      await prisma.$transaction([
        prisma.personalContext.create({
          data: {
            userId: id,
            category,
            nameEncrypted: encryptor.encrypt(name),
            relationshipEncrypted: null,
            // Bewust overgenomen als toegestane AI-context: de begeleider koos dit expliciet (DESIGN §6.3).
            aiUsageAllowed: true,
          },
        }),
        prisma.preference.update({
          where: { id: prefId },
          data: { suggestionStatus: 'accepted' },
        }),
      ]);

      const updated = await prisma.preference.findUniqueOrThrow({ where: { id: prefId } });
      return preferencePublicSchema.parse(preferenceToPublic(updated, label));
    },
  );
}

/** Zoekt het AAC-label bij een concept op (terugval = het concept zelf) voor de publieke weergave. */
async function labelFor(prisma: PrismaClient, concept: string): Promise<string> {
  const symbol = await prisma.aacSymbol.findUnique({
    where: { concept },
    select: { label: true },
  });
  return symbol?.label ?? concept;
}
