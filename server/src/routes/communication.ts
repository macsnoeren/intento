import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Encryptor } from '../crypto/encryption.js';
import type { AgentClient } from '../agents/client.js';
import { deviceAuthorize, requireDevice } from '../auth/device.js';
import { startConversation } from '../communication/conversation.js';

/**
 * Gesprekken op de tablet (INTENTO-NEW-DESIGN §51). Alleen met een apparaatsessie: het apparaat hoort
 * bij één gebruiker, en die bepaalt welk gesprek, welke Vocabulary en welke instellingen gelden. De
 * tablet praat nooit met de agentdienst; dat doet de backend hier namens hem.
 *
 * - `POST /communication/sessions` — start een gesprek (een lopend gesprek wordt gestopt). Antwoord:
 *   `{ sessionId, turn, presentation }`. Is de agentdienst er niet: 503 `AGENT_UNAVAILABLE`.
 */
export function registerCommunicationRoutes(
  app: FastifyInstance,
  deps: { env: Env; prisma: PrismaClient; encryptor: Encryptor; agents: AgentClient },
): void {
  const { prisma } = deps;
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
}
