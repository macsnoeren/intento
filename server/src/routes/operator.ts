import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createOperatorOrganizationRequestSchema,
  operatorOrganizationDetailSchema,
  operatorOrganizationListResponseSchema,
  operatorOrganizationSchema,
  type OperatorOrganization,
  type OperatorOrganizationDetail,
  type OperatorOrganizationListResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { operatorAuthorize, requireOperator } from '../auth/operator.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';

export interface OperatorRoutesDeps {
  prisma: PrismaClient;
}

/** Route-parameter: het organisatie-id uit het pad. */
const idParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Platform-operatorconsole (T8.3, DESIGN §9.1, §9.4, §10.4, ADR-0011).
 *
 * Eén tenant per organisatie werkt prima tot er iemand *boven* de tenants moet staan: wie zet een
 * nieuwe omgeving neer, wie stopt een omgeving die misbruikt wordt, wie ziet hoe het platform
 * ervoor staat? Tot nu toe kon niemand dat — elke ADMIN zit vast in zijn eigen organisatie (T1.2) en
 * `isPlatform` ontgrendelde alléén worker-tokenbeheer (T5.8). Deze routetak vult dat gat.
 *
 * Dit is de enige plek in Intento waar **niet** op `organizationId` gefilterd wordt. Die
 * doorbreking is met opzet ingekaderd:
 *
 * - **Aparte routetak, aparte guard.** Alles onder `/operator/*` hangt achter
 *   `operatorAuthorize(...)` (`auth/operator.ts`), dat `request.operator` zet en `request.account`
 *   bewust leeg laat. De tenant-helpers (`requireAccount`/`tenantScope`/`assertSameTenant`) werken
 *   hier dus domweg niet, en een gewone ADMIN krijgt op elk endpoint 403 `NOT_OPERATOR`.
 * - **Beheermetadata, geen inhoud.** De responses dragen naam/soort/status/aantallen en, in het
 *   detail, accounts (e-mail, rol, status) en gebruikers **zonder naam**. Geen boodschappen, geen
 *   gesprekken, geen persoonlijke context, geen voorkeuren — een operator beheert het platform, hij
 *   leest niet mee met de mensen erin (DESIGN §2, §9.4).
 * - **Beperkte werkwoorden.** Organisaties: lijst, detail, aanmaken, (de)activeren. Accounts en
 *   gebruikers: alleen inzien. Er is bewust geen "log in als", geen wachtwoord-reset in andermans
 *   tenant en geen eerste-admin-aanmaak: dat zou een operator stilzwijgend toegang tot communicatie
 *   geven. Een nieuwe omgeving krijgt haar beheerder via zelfaanmelding (T1.3).
 * - **Alles geaudit.** Elke muterende actie schrijft een audit-regel met de operator als actor.
 *   `organizationId` blijft daarbij `null` (net als bij worker-tokens, T5.8): dit zijn
 *   platform-acties, en zo verschijnen ze niet in de tenant-audit-lijst van een organisatie die er
 *   zelf niets aan kon doen. De betrokken organisatie staat in `targetId`/`metadata`.
 *
 * Endpoints:
 * - `GET  /operator/organizations` — alle organisaties met aantallen (nieuwste eerst).
 * - `POST /operator/organizations` — nieuwe omgeving neerzetten (zonder accounts).
 * - `GET  /operator/organizations/:id` — detail: accounts + gebruikers (metadata).
 * - `POST /operator/organizations/:id/deactivate` — omgeving stoppen (idempotent).
 * - `POST /operator/organizations/:id/activate` — omgeving weer aanzetten (idempotent).
 */
export function registerOperatorRoutes(app: FastifyInstance, { prisma }: OperatorRoutesDeps): void {
  const preHandler = operatorAuthorize(prisma);

  /** Vorm van een organisatierij inclusief de twee aggregaten die de console toont. */
  type OrganizationRow = {
    id: string;
    name: string;
    type: string;
    active: boolean;
    isPlatform: boolean;
    createdAt: Date;
    _count: { users: number; accounts: number };
  };

  /** Mapt een organisatierij naar de publieke console-vorm (alleen beheermetadata). */
  function toPublic(row: OrganizationRow): OperatorOrganization {
    return operatorOrganizationSchema.parse({
      id: row.id,
      name: row.name,
      type: row.type,
      active: row.active,
      isPlatform: row.isPlatform,
      userCount: row._count.users,
      accountCount: row._count.accounts,
      createdAt: row.createdAt.toISOString(),
    });
  }

  /** Haalt één organisatie op (met aggregaten) of gooit 404. */
  async function loadOrganization(id: string): Promise<OrganizationRow> {
    const organization = await prisma.organization.findUnique({
      where: { id },
      include: { _count: { select: { users: true, accounts: true } } },
    });
    if (!organization) {
      throw new HttpError(404, 'ORGANIZATION_NOT_FOUND', 'Organisatie niet gevonden.');
    }
    return organization;
  }

  app.get(
    '/operator/organizations',
    { preHandler },
    async (): Promise<OperatorOrganizationListResponse> => {
      // Bewust géén tenant-filter: dat is precies de bevoegdheid van deze console.
      const organizations = await prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { users: true, accounts: true } } },
      });
      return operatorOrganizationListResponseSchema.parse({
        organizations: organizations.map(toPublic),
      });
    },
  );

  app.post(
    '/operator/organizations',
    { preHandler },
    async (request, reply): Promise<OperatorOrganization> => {
      const operator = requireOperator(request);
      const { name, type } = createOperatorOrganizationRequestSchema.parse(request.body ?? {});

      // Nooit `isPlatform` vanaf hier: er is precies één platformorganisatie en die komt uit de
      // bootstrap-seed. Anders zou de console zichzelf kunnen vermenigvuldigen.
      const created = await prisma.organization.create({
        data: { name, type },
        include: { _count: { select: { users: true, accounts: true } } },
      });

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.OPERATOR_ORGANIZATION_CREATE,
        accountId: operator.id,
        organizationId: null,
        targetType: 'organization',
        targetId: created.id,
        metadata: { name: created.name, type: created.type },
      });

      reply.status(201);
      return toPublic(created);
    },
  );

  app.get(
    '/operator/organizations/:id',
    { preHandler },
    async (request): Promise<OperatorOrganizationDetail> => {
      const { id } = idParamsSchema.parse(request.params);
      const organization = await loadOrganization(id);

      const [accounts, users] = await Promise.all([
        prisma.account.findMany({
          where: { organizationId: id },
          orderBy: { createdAt: 'asc' },
          // Expliciete `select`: nooit `passwordHash` of lockout-interna, ook niet per ongeluk als
          // het Account-model later een veld erbij krijgt.
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            emailVerifiedAt: true,
            mustChangePassword: true,
            isOperator: true,
            createdAt: true,
          },
        }),
        prisma.user.findMany({
          where: { organizationId: id },
          orderBy: { createdAt: 'asc' },
          // Bewust zónder `name`: de communicerende persoon blijft binnen de tenant (DESIGN §9.4).
          select: { id: true, active: true, createdAt: true },
        }),
      ]);

      return operatorOrganizationDetailSchema.parse({
        organization: toPublic(organization),
        accounts: accounts.map((account) => ({
          id: account.id,
          email: account.email,
          name: account.name,
          role: account.role,
          emailVerified: account.emailVerifiedAt !== null,
          mustChangePassword: account.mustChangePassword,
          isOperator: account.isOperator,
          createdAt: account.createdAt.toISOString(),
        })),
        users: users.map((user) => ({
          id: user.id,
          active: user.active,
          createdAt: user.createdAt.toISOString(),
        })),
      });
    },
  );

  app.post(
    '/operator/organizations/:id/deactivate',
    { preHandler },
    async (request): Promise<OperatorOrganization> => {
      const operator = requireOperator(request);
      const { id } = idParamsSchema.parse(request.params);
      const organization = await loadOrganization(id);

      // De platformorganisatie stoppen zou de console (en het worker-tokenbeheer) buitensluiten —
      // inclusief de operator die het net deed. Bewust geblokkeerd i.p.v. "weet je het zeker?".
      if (organization.isPlatform) {
        throw new HttpError(
          400,
          'PLATFORM_ORGANIZATION_PROTECTED',
          'De platformorganisatie kan niet worden gedeactiveerd.',
        );
      }

      const updated = await prisma.organization.update({
        where: { id },
        data: { active: false },
        include: { _count: { select: { users: true, accounts: true } } },
      });

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.OPERATOR_ORGANIZATION_DEACTIVATE,
        accountId: operator.id,
        organizationId: null,
        targetType: 'organization',
        targetId: id,
        metadata: { name: updated.name },
      });

      return toPublic(updated);
    },
  );

  app.post(
    '/operator/organizations/:id/activate',
    { preHandler },
    async (request): Promise<OperatorOrganization> => {
      const operator = requireOperator(request);
      const { id } = idParamsSchema.parse(request.params);
      await loadOrganization(id);

      const updated = await prisma.organization.update({
        where: { id },
        data: { active: true },
        include: { _count: { select: { users: true, accounts: true } } },
      });

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.OPERATOR_ORGANIZATION_ACTIVATE,
        accountId: operator.id,
        organizationId: null,
        targetType: 'organization',
        targetId: id,
        metadata: { name: updated.name },
      });

      return toPublic(updated);
    },
  );
}
