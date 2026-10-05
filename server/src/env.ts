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

/**
 * Behandelt een lege waarde als "niet gezet", zodat het schema zijn default of `optional()` mag
 * doen. Nodig omdat een env-variabele in een `.env`-bestand of in `env_file:` niet weggelaten maar
 * leeggelaten wordt (`SMTP_PORT=`), en `z.coerce.number()` van een lege string een 0 maakt — die
 * dan afketst op `.positive()` met een foutmelding over een 0 die nergens staat.
 */
const blankAsUnset = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

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
    // Welke proxy's vóór de app het `X-Forwarded-For`-adres mogen bepalen.
    //
    // Was ooit een aantal hops (`TRUST_PROXY=1`). Die vorm bestaat niet meer: fastify heeft hem
    // verwijderd omdat hij te vertrouwen viel te misleiden — een client kan zelf extra
    // `X-Forwarded-For`-waarden meesturen, en met een hop-telling telt de app er dan één van de
    // client als "de proxy" (GHSA-3m5p-2c4r-xxw2). Sindsdien wijs je proxy's aan op ADRES:
    //
    //   false        niets vertrouwen — het adres van de verbinding is het client-IP. Standaard.
    //   true         alles vertrouwen. Alleen veilig als niets buiten je proxy de app kan bereiken.
    //   loopback     127.0.0.1/::1
    //   uniquelocal  de privéranges (10/8, 172.16/12, 192.168/16, fc00::/7). Wat je wilt als de
    //                app achter een reverse proxy in hetzelfde container- of privénetwerk staat
    //                en er geen poort van buitenaf op openstaat.
    //   een IP, CIDR of komma-gescheiden lijst, bv. "172.18.0.0/16".
    //
    // Zet dit alleen als er ECHT een proxy voor staat: met `true` zonder proxy mag elke bezoeker
    // zijn eigen IP opgeven, en dat adres komt in de rate limiter en het audit-log terecht.
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((value) => {
        const trimmed = value.trim();
        if (trimmed === 'true') return true;
        if (trimmed === 'false' || trimmed === '') return false;
        return trimmed;
      }),
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
    // Rate limiting op het wijzigen van het eigen wachtwoord. De route is al
    // geauthenticeerd, maar elke poging kost een argon2-verificatie én raadt effectief het
    // huidige wachtwoord — streng begrenzen dus, zonder het account te blokkeren (dat zou een
    // gekaapte sessie een makkelijke DoS op de eigenaar geven).
    PASSWORD_CHANGE_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000).default(5),
    PASSWORD_CHANGE_RATE_LIMIT_WINDOW_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .max(60)
      .default(15),
    // Rate limiting op het opnieuw uitgeven van een tijdelijk wachtwoord door een beheerder
    //. ADMIN-only en tenant-gebonden, dus geen raadaanval — maar elke aanroep trekt alle
    // sessies van een collega in en zet een wachtwoord dat die collega niet kent. Een ruimer
    // venster dan bij login volstaat; het is een zeldzame, bewuste beheeractie.
    PASSWORD_RESET_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000).default(10),
    PASSWORD_RESET_RATE_LIMIT_WINDOW_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .max(60)
      .default(15),
    // Bootstrap: krijgt de ALLEREERSTE zelfaanmelding op een lege database de platform-operatorrol?
    //
    // Staat uit, en die stand is de veilige. Zelfaanmelding is publiek, dus met deze vlag aan is de
    // rol "platformbeheerder van deze hele installatie" van wie hem als eerste opeist — op een verse,
    // bereikbare omgeving is dat niet per se jij. Zet hem aan, meld jezelf aan, klaar: vanaf dat
    // moment is er een account en doet de vlag niets meer. Hij ontwapent zichzelf.
    //
    // Wat er dan gebeurt is precies wat `db/bootstrap-seed.ts` doet: het account krijgt `isOperator`
    // en zijn organisatie `isPlatform`. Beide zijn nodig — zie de dubbele voorwaarde in
    // `auth/operator.ts` — en deze vlag is de enige andere plek waar ze gezet worden. Er is nog
    // steeds geen API waarmee iemand zichzelf of een ander tot operator promoveert.
    BOOTSTRAP_FIRST_ADMIN_AS_OPERATOR: booleanFromString.default(false),
    // Strenge rate limiting op de zelfaanmelding (publiek): tegen massaal aanmaken van
    // organisaties/accounts en account-enumeratie. Streng, want registreren is zeldzaam.
    REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000).default(5),
    REGISTER_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().max(60).default(15),
    // Tabletkoppeling. Levensduur van een koppelcode in minuten — kort, want de
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
    // Maximale grootte (bytes) van een afbeelding die binnenkomt: een upload door de beheerder of een
    // import uit een externe bron (INTENTO-NEW-DESIGN §53). Groter wordt geweigerd. Standaard 1 MB.
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024)
      .default(1024 * 1024),
    // OpenSymbols-integratie: zoeken in en importeren uit een externe bron (INTENTO-NEW-DESIGN §15).
    // De client praat nooit rechtstreeks met externe diensten; de backend doet het namens hem.
    // Basis-URL van de API (moet https zijn buiten test — SSRF/vertrouwelijkheid).
    OPENSYMBOLS_API_URL: z.url().default('https://www.opensymbols.org'),
    // Gedeeld geheim om een kortlevend access-token op te halen. Leeg = integratie uitgeschakeld
    // (de zoek-/koppelendpoints antwoorden dan met 503 FEATURE_UNAVAILABLE i.p.v. te falen).
    OPENSYMBOLS_SECRET: z.string().default(''),
    // Time-out (ms) voor externe OpenSymbols-aanroepen, zodat een trage dienst de app niet ophoudt.
    OPENSYMBOLS_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
    // E-mailverificatie (INTENTO-NEW-DESIGN §49, §53). Provider-agnostische mail-service.
    // Afzenderadres van systeemmails (verificatiemail). RFC 5322-vorm mag ("Naam <adres>").
    MAIL_FROM: z.string().min(1).default('Intento <no-reply@intento.local>'),
    // --- Mailserver: twee schrijfwijzen, kies er één -------------------------------------------
    // LEEG (allebei) = log-transport: mails worden niet echt verstuurd maar gelogd (dev/test),
    // zodat de app zonder mailserver draait (T1.3 blijft functioneren). In productie wordt
    // afgedwongen dat er één van beide staat.
    //
    // 1. SMTP_URL — één verbindingsstring (bv. smtps://user:pass@smtp.host:465). Compact, maar
    //    alles moet URL-geldig zijn: een wachtwoord met een `@`, `/`, `:`, `#` of `?` erin moet
    //    percent-gecodeerd worden, en dat is precies de fout die je pas merkt als er geen mail
    //    aankomt.
    SMTP_URL: z.string().default(''),
    // 2. SMTP_HOST en de velden hieronder — dezelfde gegevens los, zoals een hostingpakket ze
    //    opgeeft. Geen codeerregels: het wachtwoord gaat letterlijk mee, tekens en al.
    //    Zet je allebei, dan weigert de app te starten in plaats van er één te kiezen.
    SMTP_HOST: z.string().default(''),
    // Leeg = afgeleid van SMTP_SECURE: 465 bij `ssl`, 587 bij `tls`, 25 bij `none`. Leeglaten is
    // hier een gedocumenteerde keuze, vandaar `blankAsUnset`.
    SMTP_PORT: blankAsUnset(z.coerce.number().int().positive().max(65535).optional()),
    // Hoe de verbinding beveiligd wordt:
    //   tls   STARTTLS — verbinding begint onversleuteld en wordt verplicht ge-upgrade
    //         (poort 587). Het gangbaarst, en de standaard hier.
    //   ssl   implicit TLS — versleuteld vanaf de eerste byte (poort 465).
    //   none  geen TLS. Alleen toegestaan ZONDER inloggegevens; zie de controle onderaan.
    SMTP_SECURE: z.enum(['tls', 'ssl', 'none']).default('tls'),
    // Meestal het volledige e-mailadres van een bestaande mailbox op het domein.
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    // Seconden voordat een niet-reagerende mailserver wordt opgegeven. Geldt voor het verbinden,
    // voor de begroeting en voor de stilte daarna — één getal, want een mailserver die op één van
    // de drie blijft hangen houdt de aanroeper even lang op.
    SMTP_TIMEOUT_SECONDS: blankAsUnset(z.coerce.number().int().positive().max(300).default(15)),
    // Basis-URL waarnaar de verificatielink in de mail wijst; de server hangt er `?token=…` achter.
    // Wijst naar de web-app, die het token inwisselt via de API. Buiten test moet dit https zijn.
    EMAIL_VERIFICATION_URL_BASE: z.url().default('http://localhost:5173/verify-email'),
    // Basis-URL van de web-app, voor links in mails (bv. een melding aan de beheerder). Bewust géén
    // pad. Buiten test moet dit https zijn.
    APP_BASE_URL: z.url().default('http://localhost:5173'),
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
    // --- Spraakuitvoer (INTENTO-NEW-DESIGN §50, §53) ---
    // De backend praat namens de tablet met de spraakdienst; de tablet nooit rechtstreeks (INTENTO-NEW-DESIGN §51).
    // `none` = geen dienst geconfigureerd: de spraakendpoints antwoorden dan met 503 SPEECH_UNAVAILABLE
    // in plaats van te falen. `http` = de losstaande Piper-dienst uit `speech-service/`.
    SPEECH_PROVIDER: z.enum(['none', 'http']).default('none'),
    // Basis-URL van die dienst (bv. http://localhost:5002). Verplicht bij SPEECH_PROVIDER=http; buiten
    // test moet hij in productie https zijn — het is intern verkeer, maar wel met wat de gebruiker zegt.
    SPEECH_SERVICE_URL: z.string().default(''),
    // Gedeeld geheim waarmee de backend zich bij de spraakdienst meldt (Bearer). Leeg = de dienst draait
    // zonder token (alleen verdedigbaar op een gesloten netwerk).
    SPEECH_SERVICE_TOKEN: z.string().default(''),
    // Staat plain http naar de spraakdienst toe in productie. Uit, en dat hoort het te blijven zodra
    // de dienst over een netwerk bereikbaar is dat niet van jou is.
    //
    // Het bestaat voor één opstelling: backend en spraakdienst als containers op hetzelfde gesloten
    // netwerk, waar de dienst geen poort publiceert en dus alleen door zijn buren bereikt kan worden.
    // Daar is TLS tussen twee processen op dezelfde machine een certificaat dat je moet uitgeven,
    // roteren en bewaken, zonder dat er verkeer is dat iemand onderweg kan zien.
    //
    // De prijs staat hieronder in de controle: zet je hem aan, dan is SPEECH_SERVICE_TOKEN verplicht.
    // Zonder TLS is dat gedeelde geheim namelijk het enige dat de dienst nog afschermt, en wat er
    // over die verbinding gaat is precies wat de gebruiker wil zeggen.
    SPEECH_ALLOW_INSECURE_HTTP: booleanFromString.default(false),
    // Time-out (ms) voor één synthese-aanroep. Piper doet een zin in ± 100 ms; dit is de noodrem.
    SPEECH_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
    // Aantal fragmenten in de geheugencache (sleutel: hash van tekst + stem). De AAC-labels en de
    // vaste schermteksten herhalen zich constant, dus een kleine cache scheelt al bijna alle synthese.
    // De cache staat **alleen in het geheugen**: audio van wat de gebruiker zei wordt nooit opgeslagen.
    SPEECH_CACHE_MAX_ENTRIES: z.coerce.number().int().min(0).max(100_000).default(500),
    // Rate limiting op de spraakendpoints (per IP). Ruim: een gesprek vraagt makkelijk een paar zinnen
    // per minuut, en de cache vangt herhaling op. Streng genoeg tegen misbruik als audio-machine.
    SPEECH_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(10_000).default(120),
    SPEECH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().max(60).default(1),
  })
  .superRefine((value, ctx) => {
    // Een geconfigureerde spraakdienst heeft een URL nodig; anders zou de eerste zin stilletjes falen.
    if (value.SPEECH_PROVIDER === 'http') {
      if (!value.SPEECH_SERVICE_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['SPEECH_SERVICE_URL'],
          message: 'SPEECH_SERVICE_URL is verplicht bij SPEECH_PROVIDER=http.',
        });
      } else if (
        !/^https:\/\//i.test(value.SPEECH_SERVICE_URL) &&
        value.NODE_ENV === 'production'
      ) {
        if (!value.SPEECH_ALLOW_INSECURE_HTTP) {
          ctx.addIssue({
            code: 'custom',
            path: ['SPEECH_SERVICE_URL'],
            message:
              'SPEECH_SERVICE_URL moet https zijn in productie. Staat de spraakdienst als container op een gesloten netwerk zonder gepubliceerde poort, zet dan SPEECH_ALLOW_INSECURE_HTTP=true en vul SPEECH_SERVICE_TOKEN.',
          });
        } else if (!value.SPEECH_SERVICE_TOKEN) {
          // Zonder TLS én zonder token is de dienst open voor alles wat hem kan bereiken, en dat is
          // precies de aanname die SPEECH_ALLOW_INSECURE_HTTP maakt. Eén van de twee moet er zijn.
          ctx.addIssue({
            code: 'custom',
            path: ['SPEECH_SERVICE_TOKEN'],
            message:
              'SPEECH_SERVICE_TOKEN is verplicht bij SPEECH_ALLOW_INSECURE_HTTP=true: zonder TLS is het gedeelde geheim het enige dat de spraakdienst nog afschermt.',
          });
        }
      }
    }
    // Een oude hop-telling (`TRUST_PROXY=1`) is nu een adres dat op niets slaat. Fastify zou hem
    // stilzwijgend als "geen enkele proxy vertrouwd" behandelen, en dan staat er in elke logregel
    // en elke rate-limitteller het adres van de proxy in plaats van dat van de bezoeker. Zeg het
    // dus, met de vervanging erbij.
    if (typeof value.TRUST_PROXY === 'string' && /^\d+$/.test(value.TRUST_PROXY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message:
          "TRUST_PROXY is geen aantal hops meer (die vorm is verwijderd omdat hij te misleiden was). Gebruik 'false', 'true', 'loopback', 'uniquelocal' of een IP/CIDR — achter een reverse proxy in hetzelfde privé- of containernetwerk is 'uniquelocal' de juiste keuze.",
      });
    }

    // Twee schrijfwijzen voor dezelfde mailserver, en geen voorrangsregel die je kunt onthouden:
    // wie beide invult heeft er één bedoeld en de andere laten staan. Zeg dat, in plaats van er
    // stilletjes één te kiezen en de andere te negeren.
    if (value.SMTP_URL && value.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message:
          'SMTP_URL en SMTP_HOST zijn allebei gezet; kies er één (de losse velden óf de URL).',
      });
    }
    if (value.SMTP_HOST) {
      // Inloggegevens horen bij elkaar: één van de twee is een typefout of een half ingevulde
      // configuratie, en beide gevallen eindigen in een AUTH die de server weigert.
      if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) {
        ctx.addIssue({
          code: 'custom',
          path: [value.SMTP_USER ? 'SMTP_PASSWORD' : 'SMTP_USER'],
          message: 'SMTP_USER en SMTP_PASSWORD horen samen: vul ze allebei in, of allebei niet.',
        });
      }
      // De regel van transport.ts, hier al afgedwongen: de env kiest wélke TLS-variant je
      // gebruikt, nooit óf er TLS is zodra er een wachtwoord over de lijn moet. `none` bestaat
      // voor een relay zonder authenticatie op een gesloten netwerk, en voor niets anders.
      if (value.SMTP_SECURE === 'none' && value.SMTP_USER) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_SECURE'],
          message:
            "SMTP_SECURE=none mag niet samen met SMTP_USER: dat zou het wachtwoord in platte tekst versturen. Gebruik 'tls' (STARTTLS, poort 587) of 'ssl' (poort 465).",
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
    // niemand ooit een mail krijgen. Er moet dus een mailserver staan — in welke van de twee
    // schrijfwijzen dan ook.
    if (!value.SMTP_URL && !value.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message:
          'SMTP_URL of SMTP_HOST is verplicht in productie (anders worden verificatiemails niet verstuurd).',
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
    if (!/^https:\/\//i.test(value.APP_BASE_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_BASE_URL'],
        message: 'APP_BASE_URL moet https zijn in productie.',
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
