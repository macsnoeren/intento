import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
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
import { registerProfileTransferRoutes } from './routes/profile-transfer.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerOperatorRoutes } from './routes/operator.js';
import { registerSpeechRoutes } from './routes/speech.js';
import { createMailTransport, type MailTransport } from './mail/transport.js';
import { createSpeechService, type SpeechService } from './speech/index.js';
import { createEncryptor } from './crypto/encryption.js';

export interface BuildAppOptions {
  env: Env;
  /** Prisma-client; standaard de gedeelde singleton, injecteerbaar in tests. */
  prisma?: PrismaClient;
  /**
   * Fastify-logger; standaard uit in tests, aan bij de echte server. Accepteert ook de volledige
   * logger-opties, zodat een test de logregels kan opvangen (T11.6: staat de actieve strategie erin?)
   * in plaats van ze naar stdout te laten verdwijnen.
   */
  logger?: FastifyServerOptions['logger'];
  /** Mail-transport; standaard uit de env (log/SMTP), injecteerbaar zodat tests de mail opvangen. */
  mail?: MailTransport;
  /** Spraakdienst; standaard uit de env, injecteerbaar zodat tests zonder Piper draaien. */
  speech?: SpeechService;
}

/**
 * `buildApp()`-factory: bouwt een volledig geconfigureerde, maar
 * niet-luisterende Fastify-instantie. Herbruikbaar in tests via `app.inject()`
 * zonder een echte poort te openen.
 */
export async function buildApp({
  env,
  prisma = defaultPrisma,
  logger = false,
  mail = createMailTransport(env),
  speech = createSpeechService(env),
}: BuildAppOptions): Promise<FastifyInstance> {
  // Veldversleuteling at-rest: één instantie per app; de sleutel wordt uit `ENCRYPTION_KEY` afgeleid.
  const encryptor = createEncryptor(env);
  const app = Fastify({
    logger,
    // Welke proxy's het client-IP mogen bepalen; op ADRES, niet op aantal hops (zie `env.ts`).
    trustProxy: env.TRUST_PROXY,
  });

  // Security headers (CLAUDE.md security-checklist).
  await app.register(helmet);

  // De web-client (andere origin tijdens ontwikkeling) mag met cookies praten.
  // `methods` staat er expliciet bij: @fastify/cors v11 versmalde de default naar
  // `GET,HEAD,POST`, waardoor de browser-preflight elke cross-origin DELETE/PUT/PATCH blokkeerde
  // (gebruiker/context/pictogram verwijderen, instellingen opslaan). Server-tests merkten dat niet:
  // `app.inject()` doet geen preflight, dus alleen een expliciete OPTIONS-test dekt dit af.
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Ondertekende cookies (o.a. het sessietoken); geknoeide cookies worden geweigerd.
  await app.register(cookie, { secret: env.SIGNING_SECRET });

  // Rate limiting: niet globaal, alleen waar een route het expliciet configureert
  // (streng op /auth/login). Zo blijft o.a. /health onbeperkt.
  await app.register(rateLimit, { global: false });

  // Multipart-uploads (eigen afbeeldingen, N8.1). Eén bestand per request en een harde
  // groottelimiet uit de env. `throwFileSizeLimit: false` laat de plugin een te groot bestand
  // afkappen (`truncated`) i.p.v. zelf te gooien, zodat de route het weigert met onze eigen
  // consistente foutstructuur.
  await app.register(multipart, {
    throwFileSizeLimit: false,
    limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1 },
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  registerHealthRoutes(app);
  registerAuthRoutes(app, { env, prisma, mail });
  registerAccountRoutes(app, { env, prisma, mail });
  registerUserRoutes(app, { prisma });
  registerCaregiverRoutes(app, { prisma });
  registerDeviceRoutes(app, { env, prisma });
  // Profielexport/-import: eigenaarschap — versleuteld profiel exporteren en elders importeren.
  registerProfileTransferRoutes(app, { prisma, encryptor });
  // Beheerdashboard: tenant-overzicht (gebruikers en begeleiders).
  registerDashboardRoutes(app, { prisma });
  // Audit-log-inzage: ADMIN bekijkt het spoor van gevoelige acties van de eigen organisatie.
  registerAuditRoutes(app, { prisma });
  // Platform-operatorconsole: de enige, apart bewaakte routetak die over tenants heen kijkt.
  registerOperatorRoutes(app, { prisma });
  // Spraakuitvoer: de tablet laat uitspreken wat er op zijn scherm staat; de begeleider
  // beluistert stemmen vóór hij er één kiest. Altijd geregistreerd — zonder spraakdienst antwoorden
  // ze met 503 SPEECH_UNAVAILABLE, zodat de app het netjes kan opvangen.
  registerSpeechRoutes(app, { env, prisma, speech });

  return app;
}
