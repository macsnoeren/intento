import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  profileExportResponseSchema,
  profileImportRequestSchema,
  type ProfileExportResponse,
  type UserPublic,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount, requireVerifiedEmail } from '../auth/authorize.js';
import { assertSameTenant } from '../auth/tenant.js';
import type { Encryptor } from '../crypto/encryption.js';
import { userToPublic } from '../users/serialize.js';
import { buildProfileExport, encryptProfileExport, importProfile } from '../users/profile-transfer.js';

export interface ProfileTransferRoutesDeps {
  prisma: PrismaClient;
  /** Veldversleuteling at-rest (T6.1): de export-payload wordt hiermee versleuteld/ontsleuteld. */
  encryptor: Encryptor;
}

/** Route-parameter: het gebruikers-id uit het pad. */
const userParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Profielexport en -import (T8.1, DESIGN §6.4, §8.2, FR-019).
 *
 * Gegevenseigenaarschap (DESIGN §4): een beheerder kan het volledige communicatieprofiel van een gebruiker
 * exporteren als **versleuteld** bestand (onleesbaar zonder de omgevingssleutel) en het in een andere
 * omgeving weer importeren als nieuwe gebruiker. Bewust **ADMIN-only** en tenant-gebonden: het is een
 * eigenaarschaps-/beheeractie die alle persoonlijke context (PII) in één bestand bundelt, en import maakt
 * een echte persoon aan (zoals `POST /users`, dus ook `requireVerifiedEmail`). De feitelijke bouw/inlezen
 * leeft HTTP-vrij in `users/profile-transfer.ts`.
 */
export function registerProfileTransferRoutes(
  app: FastifyInstance,
  { prisma, encryptor }: ProfileTransferRoutesDeps,
): void {
  // Exporteren — ADMIN. Tenant-grens bewaakt; levert een versleutelde payload + downloadnaam.
  app.get(
    '/users/:id/export',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<ProfileExportResponse> => {
      const account = requireAccount(request);
      const { id } = userParamsSchema.parse(request.params);

      const user = await prisma.user.findUnique({ where: { id } });
      assertSameTenant(account, user);

      const payload = await buildProfileExport(prisma, encryptor, id);
      const data = encryptProfileExport(encryptor, payload);
      return profileExportResponseSchema.parse({
        data,
        filename: `intento-profiel-${id}.intento`,
      });
    },
  );

  // Importeren — ADMIN + geverifieerd e-mailadres (maakt een echte persoon aan, net als `POST /users`).
  // De nieuwe gebruiker landt in de organisatie van het account (tenant-isolatie blijft gelden).
  app.post(
    '/users/import',
    { preHandler: [authorize(prisma, { roles: ['ADMIN'] }), requireVerifiedEmail()] },
    async (request, reply): Promise<UserPublic> => {
      const account = requireAccount(request);
      const { data, name } = profileImportRequestSchema.parse(request.body);

      const user = await importProfile(prisma, encryptor, account, data, name);
      reply.status(201);
      return userToPublic(user);
    },
  );
}
