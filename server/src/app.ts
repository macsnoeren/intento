import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import type { Env } from './env.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { prisma as defaultPrisma } from './db/prisma.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerUserRoutes } from './routes/users.js';
import { registerCaregiverRoutes } from './routes/caregivers.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerAacRoutes } from './routes/aac.js';
import { createOpenSymbolsClient, type OpenSymbolsClient } from './aac/opensymbols.js';

export interface BuildAppOptions {
  env: Env;
  /** Prisma-client; standaard de gedeelde singleton, injecteerbaar in tests. */
  prisma?: PrismaClient;
  /** Fastify-logger; standaard uit in tests, aan bij de echte server. */
  logger?: boolean;
  /** OpenSymbols-proxy (T3.3); standaard uit de env, injecteerbaar zodat tests een mock meegeven. */
  openSymbols?: OpenSymbolsClient;
}

/**
 * `buildApp()`-factory (DESIGN §9.3): bouwt een volledig geconfigureerde, maar
 * niet-luisterende Fastify-instantie. Herbruikbaar in tests via `app.inject()`
 * zonder een echte poort te openen.
 */
export async function buildApp({
  env,
  prisma = defaultPrisma,
  logger = false,
  openSymbols = createOpenSymbolsClient(env),
}: BuildAppOptions): Promise<FastifyInstance> {
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

  // Ondertekende cookies (o.a. het sessietoken); geknoeide cookies worden geweigerd.
  await app.register(cookie, { secret: env.SIGNING_SECRET });

  // Rate limiting: niet globaal, alleen waar een route het expliciet configureert
  // (streng op /auth/login). Zo blijft o.a. /health onbeperkt.
  await app.register(rateLimit, { global: false });

  // Multipart-uploads (AAC-pictogrammen, T3.2). Eén bestand per request en een harde
  // groottelimiet uit de env. `throwFileSizeLimit: false` laat de plugin een te groot bestand
  // afkappen (`truncated`) i.p.v. zelf te gooien, zodat de route het weigert met onze eigen
  // consistente foutstructuur (413 IMAGE_TOO_LARGE).
  await app.register(multipart, {
    throwFileSizeLimit: false,
    limits: { fileSize: env.AAC_IMAGE_MAX_BYTES, files: 1 },
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  registerHealthRoutes(app);
  registerAuthRoutes(app, { env, prisma });
  registerAccountRoutes(app, { prisma });
  registerUserRoutes(app, { prisma });
  registerCaregiverRoutes(app, { prisma });
  registerDeviceRoutes(app, { env, prisma });
  registerAacRoutes(app, { prisma, env, openSymbols });

  return app;
}
