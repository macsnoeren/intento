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
    // (413). Standaard 512 KiB — ruim voor een pictogram, streng genoeg tegen misbruik/DoS.
    AAC_IMAGE_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024)
      .default(512 * 1024),
  })
  .superRefine((value, ctx) => {
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
