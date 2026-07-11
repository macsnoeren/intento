import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  personalContextInputSchema,
  personalContextListResponseSchema,
  type PersonalContextListResponse,
  type PersonalContextPublic,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant } from '../auth/tenant.js';
import { assertCaregiverAccess } from '../auth/caregivers.js';
import type { Encryptor } from '../crypto/encryption.js';
import { personalContextToPublic } from '../users/personal-context.js';

export interface PersonalContextRoutesDeps {
  prisma: PrismaClient;
  /** Veldversleuteling at-rest (T6.1): naam/relatie worden versleuteld opgeslagen, hier ontsleuteld. */
  encryptor: Encryptor;
}

/** Route-parameter: het gebruikers-id uit het pad. */
const userParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Persoonlijke context van een gebruiker (T6.1, DESIGN §3.7 stap 3, §6.2 PersonalContext, §6.3, §9.4,
 * FR-013/020).
 *
 * Begeleider/beheerder legt belangrijke personen, huisdieren, plekken, favorieten en routines vast zodat de
 * AI kan personaliseren — maar **alléén met expliciete toestemming per rij** (`aiUsageAllowed`, DESIGN §6.3).
 * Privacy by design:
 *   - de gevoelige velden (`name`, `relationship`) worden **versleuteld** opgeslagen (`Encryptor`) en pas hier
 *     ontsleuteld — plaintext PII staat nooit in de db (DESIGN §9.4);
 *   - de toegang is tenant-gebonden (`assertSameTenant`) en, voor een CAREGIVER, beperkt tot **gekoppelde**
 *     gebruikers (`assertCaregiverAccess`, T2.2) — net als bij `PUT /users/{id}/settings`.
 *
 * Rolverdeling volgt DESIGN §2: een begeleider **mag** persoonlijke context beheren, dus ADMIN + CAREGIVER.
 * Bewerken/verwijderen en de stapsgewijze wizard volgen in T6.2; hier alléén aanmaken en lezen (taakscope).
 */
export function registerPersonalContextRoutes(
  app: FastifyInstance,
  { prisma, encryptor }: PersonalContextRoutesDeps,
): void {
  // Aanmaken — ADMIN + CAREGIVER (gekoppeld). Gevoelige velden versleuteld opgeslagen.
  app.post(
    '/users/:id/context',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request, reply): Promise<PersonalContextPublic> => {
      const account = requireAccount(request);
      const { id } = userParamsSchema.parse(request.params);
      const input = personalContextInputSchema.parse(request.body);

      // Eerst de tenant-grens én begeleider-koppeling bewaken, dan pas schrijven.
      const user = await prisma.user.findUnique({ where: { id } });
      assertSameTenant(account, user);
      await assertCaregiverAccess(prisma, account, id);

      const created = await prisma.personalContext.create({
        data: {
          userId: id,
          category: input.category,
          nameEncrypted: encryptor.encrypt(input.name),
          relationshipEncrypted:
            input.relationship !== undefined ? encryptor.encrypt(input.relationship) : null,
          aiUsageAllowed: input.aiUsageAllowed ?? false,
        },
      });

      reply.status(201);
      return personalContextToPublic(created, encryptor);
    },
  );

  // Lijst — ADMIN + CAREGIVER (gekoppeld). Ontsleutelde weergave, gebruiker-/tenant-gefilterd.
  app.get(
    '/users/:id/context',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<PersonalContextListResponse> => {
      const account = requireAccount(request);
      const { id } = userParamsSchema.parse(request.params);

      const user = await prisma.user.findUnique({ where: { id } });
      assertSameTenant(account, user);
      await assertCaregiverAccess(prisma, account, id);

      const rows = await prisma.personalContext.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'asc' },
      });
      return personalContextListResponseSchema.parse({
        contexts: rows.map((row) => personalContextToPublic(row, encryptor)),
      });
    },
  );
}
