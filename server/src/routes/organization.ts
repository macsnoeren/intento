import type { FastifyInstance } from 'fastify';
import {
  organizationSettingsSchema,
  updateOrganizationSettingsSchema,
  type OrganizationSettings,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';

export interface OrganizationRoutesDeps {
  env: Env;
  prisma: PrismaClient;
}

/** De geldende bewaartermijn van een organisatie: haar eigen keuze, anders de standaard (§53). */
export function effectiveRetentionDays(
  organization: { retentionDays: number | null },
  env: Pick<Env, 'RETENTION_DEFAULT_DAYS'>,
): number {
  return organization.retentionDays ?? env.RETENTION_DEFAULT_DAYS;
}

/**
 * Organisatie-instellingen (INTENTO-NEW-DESIGN §49, §50, §53).
 *
 * `GET /organization/settings` en `PUT /organization/settings` — de bewaartermijn (7–365 dagen, of
 * `null` om de standaard van de installatie te volgen). Alleen de beheerder, altijd de eigen
 * organisatie: er is geen id in het pad, dus geen andere organisatie te raken. Geaudit.
 */
export function registerOrganizationRoutes(
  app: FastifyInstance,
  { env, prisma }: OrganizationRoutesDeps,
): void {
  const toSettings = (organization: { retentionDays: number | null }): OrganizationSettings =>
    organizationSettingsSchema.parse({
      retentionDays: effectiveRetentionDays(organization, env),
      retentionDaysDefault: env.RETENTION_DEFAULT_DAYS,
      usesDefault: organization.retentionDays === null,
    });

  app.get(
    '/organization/settings',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<OrganizationSettings> => {
      const { organizationId } = requireAccount(request);
      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { retentionDays: true },
      });
      return toSettings(organization);
    },
  );

  app.put(
    '/organization/settings',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<OrganizationSettings> => {
      const { organizationId } = requireAccount(request);
      const { retentionDays } = updateOrganizationSettingsSchema.parse(request.body);
      const organization = await prisma.organization.update({
        where: { id: organizationId },
        data: { retentionDays },
        select: { retentionDays: true },
      });
      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.ORGANIZATION_SETTINGS_UPDATE,
        targetType: 'organization',
        targetId: organizationId,
        metadata: { retentionDays },
      });
      return toSettings(organization);
    },
  );
}
