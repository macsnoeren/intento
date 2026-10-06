import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { findAccountBySessionToken } from './session.js';
import { readSessionToken } from './request.js';
import { findDeviceByToken, readDeviceToken } from './device.js';
import { assertOrganizationActive } from './organization-status.js';

/**
 * De organisatie van wie er belt: een ingelogd account óf een gekoppeld apparaat (tablet).
 *
 * Voor data die binnen een organisatie voor iedereen zichtbaar mag zijn — ook voor de tablet — maar
 * niet publiek, zoals de bronvermelding van de Vocabulary (INTENTO-NEW-DESIGN §15). De route erachter
 * filtert zelf op de teruggegeven organisatie. Zonder account of apparaat: 401; een gedeactiveerde
 * organisatie: 403.
 */
export async function resolveCallerOrganization(
  prisma: PrismaClient,
  request: FastifyRequest,
): Promise<string> {
  const sessionToken = readSessionToken(request);
  const account = sessionToken ? await findAccountBySessionToken(prisma, sessionToken) : null;
  let organizationId = account?.organizationId ?? null;

  if (!organizationId) {
    const deviceToken = readDeviceToken(request);
    const device = deviceToken ? await findDeviceByToken(prisma, deviceToken) : null;
    if (device) {
      const user = await prisma.user.findUnique({
        where: { id: device.userId },
        select: { organizationId: true },
      });
      organizationId = user?.organizationId ?? null;
    }
  }

  if (!organizationId) throw new HttpError(401, 'NOT_AUTHENTICATED', 'Niet ingelogd.');
  await assertOrganizationActive(prisma, organizationId);
  return organizationId;
}
