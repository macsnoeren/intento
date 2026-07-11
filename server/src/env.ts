import { z } from 'zod';

/**
 * Zod-gevalideerde omgevingsconfiguratie (CLAUDE.md §7: valideer op elke grens).
 *
 * De env wordt één keer bij het opstarten gevalideerd; de rest van de app leest
 * uit het getypeerde `env`-object en raakt `process.env` niet meer aan.
 *
 * Prod-guard: in productie mogen de dev-default-secrets niet blijven staan.
 * De app weigert dan te starten in plaats van met een onveilige sleutel te draaien.
 */

const DEV_SECRET_DEFAULTS = new Set(['dev-only-change-me', 'dev-only-change-me-32-bytes-hex']);

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    // Prisma-databaseverbinding. Dev/test: SQLite-bestand (relatief aan de server-CWD).
    // Prod: PostgreSQL-connectiestring. Zie ADR-0003 en docs/data-model.md.
    DATABASE_URL: z.string().min(1).default('file:./prisma/dev.db'),
    // Herkomst die CORS mag aanspreken (de web-client tijdens ontwikkeling).
    CORS_ORIGIN: z.url().default('http://localhost:5173'),
    // Ondertekent sessie-cookies; versleutelt gevoelige velden at-rest (vanaf latere fases).
    SIGNING_SECRET: z.string().min(1),
    ENCRYPTION_KEY: z.string().min(1),
    // `Secure`-vlag op cookies; true in productie (HTTPS).
    COOKIE_SECURE: booleanFromString.default(false),
    // Aantal proxy-hops voor correcte client-IP-bepaling achter een reverse proxy.
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    // Levensduur van een login-sessie in uren (sessietoken-cookie + db-record).
    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 365)
      .default(24 * 7),
    // Account-lockout: na dit aantal opeenvolgende mislukte logins wordt het account
    // tijdelijk geblokkeerd (brute-force-mitigatie).
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().max(100).default(5),
    // Duur van de lockout in minuten nadat de drempel is bereikt.
    LOGIN_LOCKOUT_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 60)
      .default(15),
    // Strenge rate limiting op de login-route: max verzoeken per IP per venster.
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000).default(10),
    LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().max(60).default(1),
    // Strenge rate limiting op de zelfaanmelding (T1.3, publiek): tegen massaal aanmaken van
    // organisaties/accounts en account-enumeratie. Streng, want registreren is zeldzaam.
    REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000).default(5),
    REGISTER_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().max(60).default(15),
    // Tabletkoppeling (T2.3, FR-018). Levensduur van een koppelcode in minuten — kort, want de
    // beheerder voert 'm direct op de tablet in.
    DEVICE_CODE_TTL_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 60)
      .default(15),
    // Levensduur van het apparaat-token (cookie + db-record) in dagen — lang, zodat de tablet
    // niet dagelijks opnieuw gekoppeld hoeft te worden.
    DEVICE_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(3650).default(365),
    // Strenge rate limiting op /devices/link (publiek): tegen het raden van koppelcodes.
    DEVICE_LINK_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000).default(10),
    DEVICE_LINK_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().max(60).default(1),
    // AAC-pictogramupload (T3.2, FR-015). Maximale bestandsgrootte in bytes; groter wordt geweigerd
    // (413). Standaard 512 KiB — ruim voor een pictogram, streng genoeg tegen misbruik/DoS. Geldt
    // ook voor een via OpenSymbols opgehaalde afbeelding (T3.3).
    AAC_IMAGE_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024)
      .default(512 * 1024),
    // OpenSymbols-integratie (T3.3, FR-015). De backend proxyt namens de client naar de
    // OpenSymbols-API; de client praat nooit rechtstreeks met externe diensten (DESIGN §8.1).
    // Basis-URL van de API (moet https zijn buiten test — SSRF/vertrouwelijkheid).
    OPENSYMBOLS_API_URL: z.url().default('https://www.opensymbols.org'),
    // Gedeeld geheim om een kortlevend access-token op te halen. Leeg = integratie uitgeschakeld
    // (de zoek-/koppelendpoints antwoorden dan met 503 FEATURE_UNAVAILABLE i.p.v. te falen).
    OPENSYMBOLS_SECRET: z.string().default(''),
    // Time-out (ms) voor externe OpenSymbols-aanroepen, zodat een trage dienst de app niet ophoudt.
    OPENSYMBOLS_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
    // E-mailverificatie (T1.4, DESIGN §2, §9.4). Provider-agnostische mail-service.
    // Afzenderadres van systeemmails (verificatiemail). RFC 5322-vorm mag ("Naam <adres>").
    MAIL_FROM: z.string().min(1).default('Intento <no-reply@intento.local>'),
    // SMTP-verbindingsstring (bv. smtps://user:pass@smtp.host:465). LEEG = log-transport: mails
    // worden niet echt verstuurd maar gelogd (dev/test), zodat de app zonder mailserver draait
    // (T1.3 blijft functioneren). In productie wordt een niet-lege SMTP_URL afgedwongen.
    SMTP_URL: z.string().default(''),
    // Basis-URL waarnaar de verificatielink in de mail wijst; de server hangt er `?token=…` achter.
    // Wijst naar de web-app, die het token inwisselt via de API. Buiten test moet dit https zijn.
    EMAIL_VERIFICATION_URL_BASE: z.url().default('http://localhost:5173/verify-email'),
    // Levensduur van een verificatietoken in uren — kort genoeg om lekkage te beperken, lang
    // genoeg om op je gemak op de link te klikken.
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 30)
      .default(24),
    // Strenge rate limiting op /auth/verify-email/resend (publiek): tegen mailbommen en het
    // aftasten van adressen. Streng, want opnieuw versturen hoort zelden nodig te zijn.
    RESEND_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000).default(3),
    RESEND_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().max(60).default(15),
    // AI-orchestrator (T5.1, DESIGN §7, §9.2). De backend praat namens de client met de LLM — de
    // client nooit rechtstreeks (DESIGN §8.1). De provider zit achter een provider-agnostische
    // interface (zie ADR-0008); welke concrete provider gebruikt wordt, bepaalt `AI_PROVIDER`.
    // `mock` is de deterministische provider voor dev/test (geen netwerk, geen key nodig); echte
    // providers (bv. een self-hosted `ollama`) worden in T5.2/T5.6 aangesloten.
    AI_PROVIDER: z.enum(['mock', 'ollama', 'queue']).default('mock'),
    // Verbindingsgegevens voor een echte LLM-provider. Leeg bij de mock. De sleutel is een
    // infrastructuur-credential (nooit naar de client); buiten test moet de URL https zijn.
    AI_API_URL: z.string().default(''),
    AI_API_KEY: z.string().default(''),
    // Model-identifier van de echte provider (bv. een Ollama-modelnaam). Leeg bij de mock.
    AI_MODEL: z.string().default(''),
    // Time-out (ms) voor een AI-aanroep, zodat een trage/hangende provider de flow niet ophoudt.
    // Bij `AI_PROVIDER=queue` is dit óók de maximale tijd dat de backend op een worker-resultaat wacht.
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
    // --- Gedistribueerde AI-workers (T5.5, DESIGN §7.2, §9.2, ADR-0010) ---
    // Alleen van kracht bij AI_PROVIDER=queue. De backend zet AI-aanvragen op een DB-wachtrij; externe
    // workers halen ze op (worker-initiated long-poll) en leveren gestructureerde output terug.
    // Maximum aantal gelijktijdig actieve jobs (QUEUED+CLAIMED). Daarboven → WAITING_FOR_WORKER
    // (backpressure): de aanvrager krijgt een wacht-signaal i.p.v. te blokkeren.
    AI_WORKER_MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().max(1000).default(4),
    // Lease-duur (ms) van een geclaimde job: verstrijkt die zonder heartbeat/resultaat, dan is de worker
    // vermoedelijk gecrasht en wordt de job teruggelegd in de wachtrij. Korter = sneller herstel.
    AI_WORKER_LEASE_MS: z.coerce.number().int().positive().max(600_000).default(30_000),
    // Maximaal aantal claim-pogingen voordat een job als FAILED wordt afgeschreven (crash-lus vermijden).
    AI_WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().max(100).default(3),
    // Uiterste wachttijd (ms) dat een niet-opgepakte job in de wachtrij mag staan → daarna EXPIRED
    // (nette wachtrij-timeout, geen eeuwig hangende aanvraag).
    AI_WORKER_QUEUE_TTL_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),
    // Hoe lang de claim-endpoint (long-poll) op een job wacht voordat hij 204 teruggeeft. 0 = niet
    // wachten (direct antwoord). Kort houden i.v.m. open verbindingen achter een proxy.
    AI_WORKER_CLAIM_LONGPOLL_MS: z.coerce.number().int().min(0).max(60_000).default(20_000),
    // Poll-interval (ms) waarmee de backend de wachtrij op een worker-resultaat controleert, en waarmee
    // de long-poll-claim itereert. Klein genoeg voor snelle respons, groot genoeg om niet te bonzen.
    AI_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().max(10_000).default(250),
    // Rate limiting op de worker-endpoints (per IP), tegen misbruik van een gelekt/geraden pad. Ruim,
    // want een worker die long-pollt doet weinig requests per minuut.
    AI_WORKER_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(100_000).default(600),
    AI_WORKER_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().max(60).default(1),
  })
  .superRefine((value, ctx) => {
    // Een directe (in-process) LLM-provider heeft een verbindings-URL en model nodig; anders zou de
    // orchestrator bij de eerste aanroep stilletjes falen. `queue` heeft dat NIET nodig: de externe
    // workers houden hun eigen modelconfiguratie (T5.6), de backend kent alleen de wachtrij.
    if (value.AI_PROVIDER === 'ollama') {
      if (!value.AI_API_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['AI_API_URL'],
          message: `AI_API_URL is verplicht bij AI_PROVIDER=${value.AI_PROVIDER}.`,
        });
      } else if (!/^https:\/\//i.test(value.AI_API_URL) && value.NODE_ENV === 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['AI_API_URL'],
          message: 'AI_API_URL moet https zijn in productie.',
        });
      }
      if (!value.AI_MODEL) {
        ctx.addIssue({
          code: 'custom',
          path: ['AI_MODEL'],
          message: `AI_MODEL is verplicht bij AI_PROVIDER=${value.AI_PROVIDER}.`,
        });
      }
    }
    if (value.NODE_ENV !== 'production') return;
    for (const key of ['SIGNING_SECRET', 'ENCRYPTION_KEY'] as const) {
      if (DEV_SECRET_DEFAULTS.has(value[key])) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} mag in productie niet de dev-default zijn; genereer een echte secret.`,
        });
      }
    }
    if (!value.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE moet true zijn in productie (HTTPS).',
      });
    }
    // In productie mag e-mailverificatie niet stilletjes op het log-transport draaien: dan zou
    // niemand ooit een mail krijgen. Een echte SMTP_URL is verplicht.
    if (!value.SMTP_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message:
          'SMTP_URL is verplicht in productie (anders worden verificatiemails niet verstuurd).',
      });
    }
    // De verificatielink moet in productie https zijn (token gaat niet over plain HTTP).
    if (!/^https:\/\//i.test(value.EMAIL_VERIFICATION_URL_BASE)) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_VERIFICATION_URL_BASE'],
        message: 'EMAIL_VERIFICATION_URL_BASE moet https zijn in productie.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parseert en valideert de omgeving; gooit met een leesbare melding bij fouten. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Ongeldige omgevingsconfiguratie:\n${details}`);
  }
  return result.data;
}
