import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Encryptor } from '../crypto/encryption.js';
import type { AgentClient } from '../agents/client.js';
import type { MailTransport } from '../mail/transport.js';
import { notifyNewGaps } from '../vocabulary/gap-notifications.js';
import { observeSession } from '../experience/observations.js';
import { recordAudit } from '../audit/audit.js';
import { deviceAuthorize, requireDevice } from '../auth/device.js';
import {
  answerRequestSchema,
  backRequestSchema,
  type CurrentSessionResponse,
} from '@intento/shared';
import {
  answerConversation,
  currentConversation,
  goBack,
  startConversation,
  stopConversation,
  type ConversationDeps,
} from '../communication/conversation.js';

/**
 * Gesprekken op de tablet (INTENTO-NEW-DESIGN §51). Alleen met een apparaatsessie: het apparaat hoort
 * bij één gebruiker, en die bepaalt welk gesprek, welke Vocabulary en welke instellingen gelden. De
 * tablet praat nooit met de agentdienst; dat doet de backend hier namens hem.
 *
 * - `POST /communication/sessions` — start een gesprek (een lopend gesprek wordt gestopt). Antwoord:
 *   `{ sessionId, turn, presentation }`. Is de agentdienst er niet: 503 `AGENT_UNAVAILABLE`.
 * - `GET /communication/sessions/current` — het lopende gesprek hervatten: `{ current }` of
 *   `{ current: null }`.
 * - `POST /communication/sessions/:id/answer` — JA/NEE, een gekozen tegel of "Geen van deze" op het
 *   huidige scherm. Een verouderde `turn` geeft 409 `STALE_TURN`.
 * - `POST /communication/sessions/:id/back` — ↩ Terug: `{ turn }`; zet het vorige scherm exact terug,
 *   zonder agentaanroep.
 * - `POST /communication/sessions/:id/stop` — ⏹ Stoppen.
 */
export function registerCommunicationRoutes(
  app: FastifyInstance,
  {
    mail,
    ...base
  }: {
    env: Env;
    prisma: PrismaClient;
    encryptor: Encryptor;
    agents: AgentClient;
    mail: MailTransport;
  },
): void {
  const { prisma, env } = base;
  // Een nieuw ontbrekend woord → e-mail aan de beheerders die dat willen (N9.3). Los van de beurt:
  // de tablet wacht niet op de mailserver, en een mislukte mail breekt het gesprek nooit.
  const deps: ConversationDeps = {
    ...base,
    mail,
    onNewGaps: (organizationId, concepts) => {
      notifyNewGaps(prisma, mail, env, organizationId, concepts).catch((error: unknown) => {
        app.log.error({ err: error }, 'e-mail over ontbrekende woorden mislukt');
      });
    },
    onBackgroundError: (message, error) => {
      app.log.error({ err: error }, message);
    },
    // Na afloop terugkijken (N12.4): los van de beurt, een fout raakt het gesprek nooit.
    onSessionEnded: (sessionId) => {
      observeSession(base, sessionId).catch((error: unknown) => {
        app.log.error({ err: error, sessionId }, 'terugkijken op een gesprek mislukt');
      });
    },
  };
  // Ruim genoeg voor een gesprek in vlot tempo, maar geen gratis toegang tot de agentdienst.
  const rateLimit = { max: 60, timeWindow: '1 minute' };

  app.post(
    '/communication/sessions',
    { preHandler: deviceAuthorize(prisma), config: { rateLimit } },
    async (request, reply) => {
      const device = requireDevice(request);
      const turn = await startConversation(deps, device);
      return reply.status(201).send(turn);
    },
  );

  app.get(
    '/communication/sessions/current',
    { preHandler: deviceAuthorize(prisma), config: { rateLimit } },
    async (request): Promise<CurrentSessionResponse> => {
      const device = requireDevice(request);
      return { current: await currentConversation(deps, device) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/communication/sessions/:id/answer',
    { preHandler: deviceAuthorize(prisma), config: { rateLimit } },
    async (request) => {
      const device = requireDevice(request);
      const body = answerRequestSchema.parse(request.body);
      return answerConversation(deps, device, request.params.id, body, (entry) =>
        recordAudit(prisma, request, entry),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    '/communication/sessions/:id/back',
    { preHandler: deviceAuthorize(prisma), config: { rateLimit } },
    async (request) => {
      const device = requireDevice(request);
      const { turn } = backRequestSchema.parse(request.body);
      return goBack(deps, device, request.params.id, turn);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/communication/sessions/:id/stop',
    { preHandler: deviceAuthorize(prisma), config: { rateLimit } },
    async (request, reply) => {
      const device = requireDevice(request);
      await stopConversation(deps, device, request.params.id);
      return reply.status(204).send();
    },
  );
}
