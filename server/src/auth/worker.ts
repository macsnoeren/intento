import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { WorkerTokenModel } from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import {
  verifyWorkerToken,
  WORKER_SCOPE_AI_PROCESS,
  type WorkerAuthFailure,
} from '../ai/worker-token.js';

/**
 * Worker-authenticatie (T5.5, DESIGN §9.4, ADR-0010): een **aparte** authenticatiepijler naast `authorize`
 * (accounts) en `deviceAuthorize` (tablets). Een worker is infrastructuur, geen browser: het rauwe
 * worker-token komt in de `Authorization: Bearer …`-header, niet in een cookie. Een worker-token werkt
 * nergens anders, en accountsessie-/apparaat-tokens werken niet op de worker-endpoints.
 */

declare module 'fastify' {
  interface FastifyRequest {
    workerToken?: WorkerTokenModel;
  }
}

/** Leest een bearer-token uit de Authorization-header (of `null` als die ontbreekt/niet klopt). */
export function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/** Vertaalt een weigering naar de juiste status: 401 (geen geldig credential) of 403 (niet toegestaan). */
function toHttpError(reason: WorkerAuthFailure): HttpError {
  switch (reason) {
    case 'missing':
    case 'unknown':
      return new HttpError(401, 'WORKER_UNAUTHENTICATED', 'Geen geldig worker-token.');
    case 'revoked':
    case 'expired':
      return new HttpError(403, 'WORKER_TOKEN_INACTIVE', 'Worker-token ingetrokken of verlopen.');
    case 'insufficient_scope':
      return new HttpError(403, 'WORKER_SCOPE_DENIED', 'Worker-token mist de vereiste scope.');
  }
}

/**
 * Bouwt een preHandler dat worker-authenticatie afdwingt voor de vereiste scope (standaard `ai:process`).
 * Bij succes staat het geverifieerde token op `request.workerToken`.
 */
export function workerAuthorize(
  prisma: PrismaClient,
  requiredScope: string = WORKER_SCOPE_AI_PROCESS,
): preHandlerAsyncHookHandler {
  return async (request) => {
    const token = readBearerToken(request);
    const result = await verifyWorkerToken(prisma, token, requiredScope);
    if (!result.ok) {
      throw toHttpError(result.reason);
    }
    request.workerToken = result.token;
  };
}

/** Haalt het geverifieerde worker-token op dat `workerAuthorize` zette; faalt hard bij een programmeerfout. */
export function requireWorkerToken(request: FastifyRequest): WorkerTokenModel {
  if (!request.workerToken) {
    throw new HttpError(
      500,
      'INTERNAL_ERROR',
      'Route mist de workerAuthorize()-preHandler; geen geverifieerd worker-token beschikbaar.',
    );
  }
  return request.workerToken;
}
