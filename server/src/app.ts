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
import { registerAacRoutes } from './routes/aac.js';
import { registerConversationRoutes } from './routes/conversation.js';
import { registerQuestionRoutes } from './routes/question.js';
import { registerPersonalContextRoutes } from './routes/personal-context.js';
import { registerPreferenceRoutes } from './routes/preferences.js';
import { registerProfileTransferRoutes } from './routes/profile-transfer.js';
import { registerAiWorkerRoutes } from './routes/ai-worker.js';
import { registerAiStatusRoutes } from './routes/ai-status.js';
import { registerWorkerTokenRoutes } from './routes/worker-tokens.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerConceptProposalRoutes } from './routes/concept-proposals.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerConversationHistoryRoutes } from './routes/conversation-history.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerOperatorRoutes } from './routes/operator.js';
import { createOpenSymbolsClient, type OpenSymbolsClient } from './aac/opensymbols.js';
import { createMailTransport, type MailTransport } from './mail/transport.js';
import { createAiOrchestrator, type AiOrchestrator } from './ai/index.js';
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
  /** OpenSymbols-proxy (T3.3); standaard uit de env, injecteerbaar zodat tests een mock meegeven. */
  openSymbols?: OpenSymbolsClient;
  /** Mail-transport (T1.4); standaard uit de env (log/SMTP), injecteerbaar zodat tests de mail opvangen. */
  mail?: MailTransport;
  /** AI-orchestrator (T5.2); standaard uit de env (mock/echt), injecteerbaar zodat tests een provider mocken. */
  orchestrator?: AiOrchestrator;
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
  mail = createMailTransport(env),
  orchestrator = createAiOrchestrator(env, prisma),
}: BuildAppOptions): Promise<FastifyInstance> {
  // Veldversleuteling at-rest (T6.1): persoonlijke context wordt versleuteld opgeslagen. Eén instantie
  // per app; de sleutel wordt uit `ENCRYPTION_KEY` afgeleid en gedeeld door de context- en gespreksroutes.
  const encryptor = createEncryptor(env);
  const app = Fastify({
    logger,
    // Vertrouw op het opgegeven aantal proxy-hops voor correcte client-IP-bepaling.
    trustProxy: env.TRUST_PROXY,
  });

  // Security headers (CLAUDE.md security-checklist).
  await app.register(helmet);

  // De web-client (andere origin tijdens ontwikkeling) mag met cookies praten.
  // `methods` staat er expliciet bij (T8.4): @fastify/cors v11 versmalde de default naar
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
  registerAuthRoutes(app, { env, prisma, mail });
  registerAccountRoutes(app, { env, prisma, mail });
  registerUserRoutes(app, { prisma });
  registerCaregiverRoutes(app, { prisma });
  registerDeviceRoutes(app, { env, prisma });
  registerAacRoutes(app, { prisma, env, openSymbols });
  registerConversationRoutes(app, { prisma, orchestrator, encryptor, env, openSymbols });
  // Vraagmodus (T7.1): begeleider stelt een gebruiker een vraag; de AI beperkt de antwoorden.
  registerQuestionRoutes(app, { prisma });
  // Persoonlijke context (T6.1): begeleider/beheerder legt personen/plekken/routines vast (versleuteld).
  registerPersonalContextRoutes(app, { prisma, encryptor });
  // Voorkeuren + begeleider-suggestie (T6.3): leren gebeurt bij `/confirm`; hier bekijkt/handelt beheer af.
  registerPreferenceRoutes(app, { prisma, encryptor });
  // Profielexport/-import (T8.1): eigenaarschap — versleuteld profiel exporteren en elders importeren.
  registerProfileTransferRoutes(app, { prisma, encryptor });
  // Worker-endpoints voor de gedistribueerde AI-wachtrij (T5.5). Altijd geregistreerd: ze werken op de
  // AiJob-tabel en zijn onschadelijk zonder queue-provider (er komen dan simpelweg geen jobs binnen).
  registerAiWorkerRoutes(app, { env, prisma });
  // AI-status (T9.4): draait er een echte AI en is er een worker actief? Alleen infrastructuurmetadata,
  // leesbaar voor een ingelogd account én voor de tablet, zodat beide kunnen tonen dát er een AI meedenkt.
  registerAiStatusRoutes(app, { prisma, env });
  // Beheer-UI voor worker-tokens (T5.8): platform-ADMIN mint/lijst/trekt infra-credentials in.
  registerWorkerTokenRoutes(app, { prisma });
  // Beheerdashboard (T7.3): tenant-overzicht (gebruikers/begeleiders/activiteit) + openstaande voorstellen.
  registerDashboardRoutes(app, { prisma });
  // AI-conceptvoorstellen (T7.3): reviewlijst + goedkeuren (koppelen aan pictogram) / afwijzen.
  registerConceptProposalRoutes(app, { prisma });
  // Audit-log-inzage (T8.2): ADMIN bekijkt het spoor van gevoelige acties van de eigen organisatie.
  registerAuditRoutes(app, { prisma });
  registerConversationHistoryRoutes(app, { prisma });
  registerMessageRoutes(app, { prisma });
  // Platform-operatorconsole (T8.3): de enige, apart bewaakte routetak die over tenants heen kijkt.
  registerOperatorRoutes(app, { prisma });

  return app;
}
