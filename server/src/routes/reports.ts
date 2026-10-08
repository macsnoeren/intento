import type { FastifyInstance } from 'fastify';
import { biasReportQuerySchema, biasReportSchema, type BiasReport } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Encryptor } from '../crypto/encryption.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant } from '../auth/tenant.js';
import { biasReport } from '../reports/bias.js';

/**
 * Rapporten voor de beheerder (N14.3).
 *
 * `GET /reports/bias?days=&userId=` — het bias-rapport (INTENTO-NEW-DESIGN §24 B4/B5) over de eigen
 * organisatie, of één gebruiker daarvan, binnen de bewaartermijn of de laatste `days` dagen. Alleen de
 * beheerder; een gebruiker van een andere organisatie of een onbekend id geeft 403.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function registerReportRoutes(
  app: FastifyInstance,
  { prisma, encryptor }: { prisma: PrismaClient; encryptor: Encryptor },
): void {
  app.get(
    '/reports/bias',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<BiasReport> => {
      const account = requireAccount(request);
      const { days, userId } = biasReportQuerySchema.parse(request.query);
      if (userId)
        assertSameTenant(account, await prisma.user.findUnique({ where: { id: userId } }));
      const report = await biasReport(prisma, encryptor, {
        organizationId: account.organizationId,
        ...(userId ? { userId } : {}),
        ...(days ? { since: new Date(Date.now() - days * DAY_MS) } : {}),
      });
      return biasReportSchema.parse(report);
    },
  );
}
