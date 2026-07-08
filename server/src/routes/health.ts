import type { FastifyInstance } from 'fastify';
import { healthResponseSchema, type HealthResponse } from '@intento/shared';

/**
 * Liveness/health-endpoint. Bevestigt dat de server draait en reageert.
 * Bewust ongeauthenticeerd en zonder DB-afhankelijkheid (fase 0).
 */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', (): HealthResponse => {
    const body: HealthResponse = {
      status: 'ok',
      service: 'intento-server',
      timestamp: new Date().toISOString(),
    };
    // Valideer de eigen output tegen het gedeelde schema (fail fast bij drift).
    return healthResponseSchema.parse(body);
  });
}
