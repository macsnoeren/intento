import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import type { Env } from './env.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { registerHealthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  env: Env;
  /** Fastify-logger; standaard uit in tests, aan bij de echte server. */
  logger?: boolean;
}

/**
 * `buildApp()`-factory (DESIGN §9.3): bouwt een volledig geconfigureerde, maar
 * niet-luisterende Fastify-instantie. Herbruikbaar in tests via `app.inject()`
 * zonder een echte poort te openen.
 */
export async function buildApp({ env, logger = false }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    // Vertrouw op het opgegeven aantal proxy-hops voor correcte client-IP-bepaling.
    trustProxy: env.TRUST_PROXY,
  });

  // Security headers (CLAUDE.md security-checklist).
  await app.register(helmet);

  // De web-client (andere origin tijdens ontwikkeling) mag met cookies praten.
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  registerHealthRoutes(app);

  return app;
}
