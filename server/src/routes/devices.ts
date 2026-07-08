import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  deviceCodeResponseSchema,
  deviceSessionResponseSchema,
  devicePublicSchema,
  linkDeviceRequestSchema,
  type DeviceCodeResponse,
  type DeviceSessionResponse,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { DeviceModel } from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant } from '../auth/tenant.js';
import { DEVICE_COOKIE_NAME, deviceCookieOptions } from '../auth/cookie.js';
import {
  createLinkCode,
  deviceAuthorize,
  linkDeviceByCode,
  requireDevice,
} from '../auth/device.js';
import { userToPublic } from '../users/serialize.js';

export interface DeviceRoutesDeps {
  env: Env;
  prisma: PrismaClient;
}

/** Route-parameter: het gebruikers-id uit het pad. */
const userParamsSchema = z.object({ id: z.string().min(1) });

/** Publieke weergave van een apparaat (nooit het token of de hash). */
function toDevicePublic(device: DeviceModel) {
  return devicePublicSchema.parse({
    id: device.id,
    userId: device.userId,
    type: device.type,
    lastActive: device.lastActive.toISOString(),
  });
}

/** Bouwt de device-sessieweergave (apparaat + eigen gebruiker met communicatieprofiel). */
async function buildDeviceSession(
  prisma: PrismaClient,
  device: DeviceModel,
): Promise<DeviceSessionResponse> {
  const user = await prisma.user.findUnique({
    where: { id: device.userId },
    include: { communicationProfile: true },
  });
  if (!user) {
    // Kan alleen als de gebruiker net verwijderd is; cascade ruimt het apparaat normaal mee op.
    throw new HttpError(404, 'USER_NOT_FOUND', 'De gekoppelde gebruiker bestaat niet meer.');
  }
  return deviceSessionResponseSchema.parse({
    device: toDevicePublic(device),
    user: userToPublic(user),
  });
}

/**
 * Tabletkoppeling (T2.3, DESIGN §6.2, §8.2, FR-018).
 *
 * Flow: een **beheerder** genereert een koppelcode voor een gebruiker
 * (`POST /admin/users/{id}/device-code`). De **tablet** wisselt die code eenmalig in voor een
 * langlevend apparaat-token (`POST /devices/link`, niet ingelogd, streng rate-limited) en start
 * daarna direct in de gebruikersapp zonder dagelijkse login. Het apparaat-token geeft **alléén**
 * toegang tot de eigen gebruiker (`GET /device/me`) — nooit tot beheer- of accountroutes.
 *
 * Beveiliging: code en token staan alleen gehasht in de db; codes verlopen en zijn eenmalig
 * (zie `auth/device.ts`); tenant-isolatie op het genereren via `assertSameTenant`.
 */
export function registerDeviceRoutes(
  app: FastifyInstance,
  { env, prisma }: DeviceRoutesDeps,
): void {
  const deviceMaxAgeSeconds = env.DEVICE_TOKEN_TTL_DAYS * 24 * 60 * 60;

  // Koppelcode genereren — ADMIN. Tenant-gebonden: de gebruiker moet in de eigen organisatie
  // zitten. De plaintext code wordt hier één keer teruggegeven (daarna alleen de hash bekend).
  app.post(
    '/admin/users/:id/device-code',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request, reply): Promise<DeviceCodeResponse> => {
      const account = requireAccount(request);
      const { id } = userParamsSchema.parse(request.params);

      const user = await prisma.user.findUnique({ where: { id } });
      assertSameTenant(account, user);

      const { code, expiresAt } = await createLinkCode(prisma, id, env.DEVICE_CODE_TTL_MINUTES);
      reply.status(201);
      return deviceCodeResponseSchema.parse({ code, expiresAt: expiresAt.toISOString() });
    },
  );

  // Koppelen — publiek (de tablet heeft nog geen sessie), streng rate-limited tegen het raden
  // van codes. Wisselt de code in voor een apparaat-token dat als langlevende cookie meegaat.
  app.post(
    '/devices/link',
    {
      config: {
        rateLimit: {
          max: env.DEVICE_LINK_RATE_LIMIT_MAX,
          timeWindow: env.DEVICE_LINK_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
        },
      },
    },
    async (request, reply): Promise<DeviceSessionResponse> => {
      const { code } = linkDeviceRequestSchema.parse(request.body);

      const linked = await linkDeviceByCode(prisma, code, 'tablet');
      if (!linked) {
        // Bewust generiek: geen onderscheid tussen onbekend, verlopen of al gebruikt.
        throw new HttpError(
          400,
          'INVALID_LINK_CODE',
          'Koppelcode ongeldig, verlopen of al gebruikt.',
        );
      }

      reply.setCookie(
        DEVICE_COOKIE_NAME,
        linked.token,
        deviceCookieOptions(env, deviceMaxAgeSeconds),
      );
      reply.status(201);
      return buildDeviceSession(prisma, linked.device);
    },
  );

  // Eigen gebruiker ophalen — device-auth. Dit is de enige data waartoe een apparaat-token
  // toegang geeft: de gebruiker waaraan het gebonden is (nooit een andere gebruiker).
  app.get(
    '/device/me',
    { preHandler: deviceAuthorize(prisma) },
    async (request): Promise<DeviceSessionResponse> => {
      return buildDeviceSession(prisma, requireDevice(request));
    },
  );
}
