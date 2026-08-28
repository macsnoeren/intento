import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { speakRequestSchema, speechPreviewRequestSchema, toSpeechVoice } from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant } from '../auth/tenant.js';
import { assertCaregiverAccess } from '../auth/caregivers.js';
import { deviceAuthorize, requireDevice } from '../auth/device.js';
import type { SpeechAudio, SpeechService } from '../speech/index.js';

/**
 * Spraakuitvoer (T18.1, DESIGN §5.1, §5.3, §8.1, §9.4).
 *
 * Twee routes, één dienst erachter:
 *
 * - `POST /device/speech` — de **tablet** vraagt om audio bij een tekst. De stem komt uit het profiel
 *   van de gebruiker achter de apparaatsessie; de tablet kiest die dus niet zelf, en kan ook niet
 *   namens een andere gebruiker laten spreken. Staat spraak uit, dan komt er niets uit de server.
 * - `POST /admin/users/:id/speech-preview` — de **begeleider** beluistert een stem vóór hij hem kiest
 *   (T18.2), met een expliciete stem en zonder de instelling al op te slaan. Zelfde grens als de rest
 *   van de gebruikersroutes: eigen organisatie, en voor een CAREGIVER alleen gekoppelde gebruikers.
 *
 * Beide antwoorden met audio en `Cache-Control: no-store`: de zin van een gebruiker hoort niet in een
 * tussenliggende cache te blijven hangen (DESIGN §9.4). Server-side leeft hij alleen in het geheugen.
 */

const userParamsSchema = z.object({ id: z.string().min(1) });

export interface SpeechRoutesDeps {
  env: Env;
  prisma: PrismaClient;
  speech: SpeechService;
}

/** Zet een gesynthetiseerd fragment als binaire respons neer (nooit cachebaar). */
function sendAudio(reply: FastifyReply, spoken: SpeechAudio): FastifyReply {
  return reply
    .header('Content-Type', spoken.contentType)
    .header('Content-Length', String(spoken.audio.length))
    .header('Cache-Control', 'no-store')
    .send(spoken.audio);
}

export function registerSpeechRoutes(
  app: FastifyInstance,
  { env, prisma, speech }: SpeechRoutesDeps,
): void {
  const rateLimit = {
    max: env.SPEECH_RATE_LIMIT_MAX,
    timeWindow: env.SPEECH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  };

  // De tablet laat uitspreken wat er op zijn scherm staat — device-auth.
  app.post(
    '/device/speech',
    { preHandler: deviceAuthorize(prisma), config: { rateLimit } },
    async (request, reply) => {
      const device = requireDevice(request);
      const { text } = speakRequestSchema.parse(request.body);

      const profile = await prisma.userCommunicationProfile.findUnique({
        where: { userId: device.userId },
      });
      // Geen profiel = de standaardinstellingen, en daarin staat spraak uit.
      if (!profile?.speechEnabled) {
        throw new HttpError(403, 'SPEECH_DISABLED', 'Spraakuitvoer staat uit voor deze gebruiker.');
      }

      return sendAudio(reply, await speech.speak(text, toSpeechVoice(profile.speechVoice)));
    },
  );

  // De begeleider beluistert een stem vóór hij hem kiest — accountsessie, tenant-gefilterd.
  app.post(
    '/admin/users/:id/speech-preview',
    {
      preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }),
      config: { rateLimit },
    },
    async (request, reply) => {
      const account = requireAccount(request);
      const { id } = userParamsSchema.parse(request.params);
      const { text, voice } = speechPreviewRequestSchema.parse(request.body);

      const user = await prisma.user.findUnique({ where: { id } });
      assertSameTenant(account, user);
      await assertCaregiverAccess(prisma, account, id);

      return sendAudio(reply, await speech.speak(text, voice));
    },
  );
}
