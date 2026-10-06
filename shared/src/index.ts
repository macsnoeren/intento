import { z } from 'zod';

export * from './agent-contract.js';

/**
 * Gedeelde zod-schema's en types tussen server en web.
 *
 * Bron van waarheid voor de vorm van API-payloads. Zowel de server (validatie +
 * response-typing) als de web-client (fetch-typing) importeren hieruit, zodat
 * client en server nooit uit elkaar lopen.
 */

/** Consistente foutstructuur (INTENTO-NEW-DESIGN §51): `{ error: { code, message } }`. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Antwoord van het health-endpoint. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('intento-server'),
  timestamp: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Rollen van een account (INTENTO-NEW-DESIGN §49). Ook de bron voor de db-validatie op de grens. */
export const accountRoleSchema = z.enum(['ADMIN', 'CAREGIVER', 'USER']);
export type AccountRole = z.infer<typeof accountRoleSchema>;

/**
 * Soort omgeving (INTENTO-NEW-DESIGN §39, `Organization.type`): een familie, een zorginstelling of een
 * persoonlijke omgeving. Bewust een gesloten lijst — gevalideerd op de API-grens (geen native
 * enum i.v.m. SQLite/PostgreSQL-portabiliteit). Een ongeldige waarde levert een 400.
 */
export const organizationTypeSchema = z.enum(['family', 'care', 'personal']);
export type OrganizationType = z.infer<typeof organizationTypeSchema>;

/**
 * Wachtwoordsterkte-eis bij het aanmaken van een account (zelfaanmelding). Bewust
 * strenger dan bij login (die valideert alleen niet-leeg): minstens 12 tekens en niet louter
 * herhaling van één teken, zodat een zwak wachtwoord al op de grens (400) wordt geweigerd.
 * De bovengrens beschermt tegen argon2-DoS met absurd lange invoer.
 */
export const strongPasswordSchema = z
  .string()
  .min(12, 'Wachtwoord moet minstens 12 tekens bevatten.')
  .max(200, 'Wachtwoord mag hoogstens 200 tekens bevatten.')
  .refine((value) => new Set(value).size > 1, {
    message: 'Kies een sterker wachtwoord (niet één herhaald teken).',
  });

/**
 * Registratieverzoek (INTENTO-NEW-DESIGN §49, `POST /auth/register`). Een nieuwe bezoeker
 * meldt in één keer een organisatie/familie aan én maakt het eerste ADMIN-account. `email` wordt
 * genormaliseerd naar lowercase (zoals bij login) zodat hoofdletters niet tot dubbele accounts
 * leiden; `password` moet aan de sterkte-eis voldoen. Alle velden worden op de server opnieuw
 * gevalideerd — dit schema is de gedeelde bron van waarheid.
 */
export const registerRequestSchema = z.object({
  organizationName: z.string().trim().min(1).max(200),
  organizationType: organizationTypeSchema,
  adminName: z.string().trim().min(1).max(200),
  email: z
    .email()
    .max(320)
    .transform((value) => value.toLowerCase()),
  password: strongPasswordSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/**
 * Login-verzoek (`POST /auth/login`). E-mail wordt naar lowercase genormaliseerd zodat
 * hoofdletters de login niet beïnvloeden. Wachtwoord alleen op niet-leeg gevalideerd —
 * sterkte-eisen horen bij het aanmaken van accounts (latere taak), niet bij login.
 */
export const loginRequestSchema = z.object({
  email: z
    .email()
    .max(320)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Publieke weergave van het ingelogde account (nooit hash of interne lockout-velden). */
export const accountPublicSchema = z.object({
  id: z.string(),
  email: z.email(),
  role: accountRoleSchema,
  organizationId: z.string(),
  /**
   * Weergavenaam van de accounthouder (T1.3 admin, T2.4 begeleider). `null` voor geseede/oudere
   * accounts die zonder naam zijn aangemaakt — de beheer-UI valt dan terug op het e-mailadres.
   */
  name: z.string().nullable(),
  /**
   * Of het e-mailadres is geverifieerd. Onbevestigde accounts mogen inloggen, maar
   * bepaalde gevoelige acties zijn geblokkeerd tot verificatie; de web-UI toont hierop een
   * herinnerings-banner met een "opnieuw versturen"-knop.
   */
  emailVerified: z.boolean(),
  /**
   * Of dit account nog op het **tijdelijke** wachtwoord zit dat de server bij het aanmaken
   * genereerde en aan de beheerder toonde. Zolang dit `true` is kent een tweede persoon het
   * wachtwoord; de server staat dan alléén `GET /auth/me` en `POST /auth/password` toe en de
   * web-UI toont de houder een blokkerend "kies eerst een eigen wachtwoord"-scherm. In de
   * accountlijst van de beheerder verschijnt het als markering, zodat zichtbaar is wie nog niet
   * is overgestapt. Zelf gekozen wachtwoorden (zelfaanmelding T1.3, seed) zijn nooit gemarkeerd.
   */
  mustChangePassword: z.boolean(),
  /**
   * Of dit account de **platform-operatorconsole** mag gebruiken. Bewust géén rol maar een
   * aparte bevoegdheid: de rol bepaalt wat je binnen je eigen organisatie mag, deze vlag ontgrendelt
   * de cross-tenant console op `/operator`. De web-client gebruikt 'm alleen om de ingang te tonen —
   * de echte grens ligt op de server (`operatorAuthorize`), die elke operator-route apart bewaakt.
   */
  isOperator: z.boolean(),
});
export type AccountPublic = z.infer<typeof accountPublicSchema>;

/** Antwoord van `POST /auth/login` en `GET /auth/me`. */
export const authResponseSchema = z.object({
  account: accountPublicSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

// --- Eigen wachtwoord wijzigen (INTENTO-NEW-DESIGN §49, §39, §53) ---

/**
 * Verzoek om het **eigen** wachtwoord te wijzigen (`POST /auth/password`). Er zit bewust
 * géén account-id in: de server pakt altijd het ingelogde account uit de sessie, zodat niemand
 * via de body het wachtwoord van een ander kan zetten.
 *
 * `currentPassword` is verplicht (her-authenticatie: een gekaapte sessie of een onbeheerd
 * apparaat kan het wachtwoord niet zomaar overnemen) en wordt — net als bij login — alleen op
 * niet-leeg gevalideerd; sterkte-eisen gelden voor het **nieuwe** wachtwoord. De extra `refine`
 * weigert "wijzigen" naar hetzelfde wachtwoord: dat zou de sessies van dit account intrekken
 * zonder dat er iets verandert, en is bij een tijdelijk wachtwoord juist niet de bedoeling.
 */
export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: strongPasswordSchema,
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'Kies een ander wachtwoord dan het huidige.',
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/**
 * Antwoord op `POST /auth/password`: hoeveel **andere** sessies van dit account zijn ingetrokken
 * (de huidige sessie blijft geldig, zodat de wijziger niet uit zijn eigen scherm valt). De web-UI
 * meldt daarmee expliciet dat andere apparaten opnieuw moeten inloggen — een zichtbare
 * bevestiging dat een eventuele meelifter eruit ligt.
 */
export const changePasswordResponseSchema = z.object({
  revokedSessions: z.number().int().nonnegative(),
});
export type ChangePasswordResponse = z.infer<typeof changePasswordResponseSchema>;

// --- E-mailverificatie (INTENTO-NEW-DESIGN §49, §53) ---

/**
 * Inwisselverzoek van een verificatietoken (`POST /auth/verify-email`, of `GET` met `?token=`).
 * Het rauwe token komt uit de verificatiemail; de server hasht het en zoekt op de hash. Bewust
 * begrensd op lengte tegen absurde invoer; de eigenlijke geldigheid (bestaat/verlopen/gebruikt)
 * wordt server-side bepaald en levert altijd dezelfde neutrale foutmelding (geen enumeratie).
 */
export const verifyEmailRequestSchema = z.object({
  token: z.string().trim().min(1).max(512),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

/**
 * Opnieuw-versturen-verzoek (`POST /auth/verify-email/resend`). Publiek en streng rate-limited.
 * Neemt alléén een e-mailadres; het antwoord is **altijd** neutraal, ongeacht of het adres
 * bestaat of al geverifieerd is (geen account-enumeratie). E-mail naar lowercase genormaliseerd,
 * net als bij login/registratie.
 */
export const resendVerificationRequestSchema = z.object({
  email: z
    .email()
    .max(320)
    .transform((value) => value.toLowerCase()),
});
export type ResendVerificationRequest = z.infer<typeof resendVerificationRequestSchema>;

/**
 * Antwoord op `POST /auth/verify-email`: of de verificatie is geslaagd. Bij een ongeldig,
 * verlopen of reeds gebruikt token is `verified: false` met een neutrale melding in de body van
 * de foutrespons — nooit een hint of het adres/token bestond.
 */
export const verifyEmailResponseSchema = z.object({
  verified: z.literal(true),
  account: accountPublicSchema,
});
export type VerifyEmailResponse = z.infer<typeof verifyEmailResponseSchema>;

/**
 * Neutraal antwoord op `POST /auth/verify-email/resend`: altijd hetzelfde, of het adres nu
 * bestond of niet. De web-UI toont een generieke "als het adres bestaat, is er een mail
 * verstuurd"-melding.
 */
export const resendVerificationResponseSchema = z.object({
  message: z.string(),
});
export type ResendVerificationResponse = z.infer<typeof resendVerificationResponseSchema>;

/**
 * Antwoord van `GET /admin/accounts`: de logins binnen de eigen organisatie (ADMIN-only).
 * De lijst is per definitie tenant-gefilterd — een organisatie ziet nooit accounts van een
 * andere organisatie (INTENTO-NEW-DESIGN §53, multi-tenant-isolatie).
 */
export const accountListResponseSchema = z.object({
  accounts: z.array(accountPublicSchema),
});
export type AccountListResponse = z.infer<typeof accountListResponseSchema>;

/**
 * Aanmaakverzoek voor een **begeleider-account** (`POST /admin/accounts`, INTENTO-NEW-DESIGN §49). Bewust **zonder rolveld**: de server zet de rol hard op `CAREGIVER` en de organisatie op
 * die van de aanroepende ADMIN. Zo kan een meegestuurde `role`/`organizationId` nooit tot
 * privilege-escalatie of een account in een andere tenant leiden. Ook **zonder wachtwoordveld**: de
 * server genereert een sterk tijdelijk wachtwoord (zie `createCaregiverResponseSchema`), zodat een
 * beheerder geen zwak wachtwoord kan kiezen voor iemand anders. E-mail naar lowercase
 * genormaliseerd, net als bij login/registratie.
 */
export const createCaregiverRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z
    .email()
    .max(320)
    .transform((value) => value.toLowerCase()),
});
export type CreateCaregiverRequest = z.infer<typeof createCaregiverRequestSchema>;

/**
 * Antwoord van `POST /admin/accounts`: het nieuwe begeleider-account plus het **tijdelijke
 * wachtwoord**. Dat wachtwoord is server-gegenereerd en wordt hier — net als een koppelcode
 * — **één keer** teruggegeven; in de db staat alleen de argon2id-hash,
 * dus het is daarna niet meer op te vragen. De beheerder geeft het via een veilig kanaal aan de
 * begeleider door.
 */
export const createCaregiverResponseSchema = z.object({
  account: accountPublicSchema,
  temporaryPassword: z.string(),
});
export type CreateCaregiverResponse = z.infer<typeof createCaregiverResponseSchema>;

/**
 * Antwoord van `POST /admin/accounts/{id}/password` (INTENTO-NEW-DESIGN §49, §39, §53): een
 * beheerder geeft een **nieuw** server-gegenereerd tijdelijk wachtwoord uit voor een account in de
 * eigen organisatie dat is vastgelopen — het tijdelijke wachtwoord uit T2.4 kwijt, of buitengesloten
 * door de lockout. Zonder deze actie is er geen weg terug: inloggen lukt niet en zonder sessie is
 * `POST /auth/password` onbereikbaar.
 *
 * Zelfde eigenschappen als bij aanmaken: het wachtwoord is server-gegenereerd, wordt hier
 * **één keer** teruggegeven en staat daarna alleen nog als argon2id-hash in de db. Het account is
 * daarna opnieuw als `mustChangePassword` gemarkeerd, dus de houder komt bij de eerstvolgende login
 * meteen op het blokkerende wachtwoordscherm. `revokedSessions` telt de sessies van dat account die
 * hierbij zijn ingetrokken — álle sessies, ook op andere apparaten: wie met het oude wachtwoord
 * binnenkwam, ligt eruit. (De beheerder wijzigt hier dus nooit zíjn eigen wachtwoord; dat loopt via
 * `POST /auth/password`.)
 */
export const resetAccountPasswordResponseSchema = z.object({
  account: accountPublicSchema,
  temporaryPassword: z.string(),
  revokedSessions: z.number().int().nonnegative(),
});
export type ResetAccountPasswordResponse = z.infer<typeof resetAccountPasswordResponseSchema>;

// --- Gebruikers en communicatieprofiel ---

// --- Spraakuitvoer (INTENTO-NEW-DESIGN §50, §53, T18.1/T18.2) ---

/**
 * De **stemmen** die een begeleider kan kiezen. Eén bron voor de server (die valideert en de
 * spraakdienst aanroept) en de beheer-UI (die de keuze toont met een luisterknop), zodat een stem nooit
 * onder twee namen rondloopt.
 *
 * `kind` splitst de lijst in tweeën:
 * - `server` — een Piper-stemmodel dat de spraakdienst synthetiseert. Overal identiek, ook op een
 *   tablet zonder Nederlandse stem.
 * - `device` — de stem die de tablet zélf heeft (`speechSynthesis`). Klinkt per apparaat anders en is
 *   dus niet voorspelbaar, maar op een Android-tablet of iPad is dit vaak de natuurlijkste — en het is
 *   de enige weg naar een Nederlandse **vrouwenstem** (zie hieronder).
 *
 * Waarom er maar vier servermodellen in staan terwijl Piper er tien voor het Nederlands heeft: van de
 * overige zes deugt de verstaanbaarheid niet. `nl_NL-mls-medium` (52 sprekers, waaronder alle
 * Nederlandse vrouwenstemmen) en de twee losse `mls_*-low`-modellen komen uit ruwe luisterboekdata;
 * bij het beluisteren op 2026-08-28 bleek geen van die stemmen een zin verstaanbaar uit te spreken. Ze
 * staan hier daarom bewust **niet** in — een onverstaanbare stem is voor deze doelgroep erger dan geen
 * stem. Daarmee is Nathalie (Vlaams) de enige vrouwenstem die de server kan leveren; wie een
 * Nederlandse vrouwenstem wil, kiest voorlopig de stem van het apparaat (zie T18.5).
 */
export const SPEECH_VOICE_CATALOG: readonly {
  id: string;
  label: string;
  kind: 'server' | 'device';
  description: string;
  region?: 'nl_NL' | 'nl_BE';
  voiceType?: 'man' | 'vrouw';
}[] = [
  {
    id: 'nl_NL-pim-medium',
    label: 'Pim',
    kind: 'server',
    region: 'nl_NL',
    voiceType: 'man',
    description: 'Nederlandse mannenstem, rustig tempo. De standaardstem.',
  },
  {
    id: 'nl_NL-alex-medium',
    label: 'Alex',
    kind: 'server',
    region: 'nl_NL',
    voiceType: 'man',
    description: 'Nederlandse mannenstem, duidelijk vlotter dan de andere stemmen.',
  },
  {
    id: 'nl_NL-ronnie-medium',
    label: 'Ronnie',
    kind: 'server',
    region: 'nl_NL',
    voiceType: 'man',
    description: 'Nederlandse mannenstem, rustig en laag van toon.',
  },
  {
    id: 'nl_BE-nathalie-medium',
    label: 'Nathalie',
    kind: 'server',
    region: 'nl_BE',
    voiceType: 'vrouw',
    description: 'Vlaamse vrouwenstem, vlot tempo. De enige vrouwenstem die de server kan leveren.',
  },
  {
    id: 'device',
    label: 'Stem van het apparaat',
    kind: 'device',
    description:
      'De tablet spreekt zelf, met de stem die het apparaat heeft. Op een Android-tablet of iPad ' +
      'is dat meestal een goede Nederlandse stem (vaak een vrouwenstem); op een pc kan hij ' +
      'blikkerig klinken. Beluister hem daarom op het apparaat zelf.',
  },
];

/** De stem-id's uit de catalogus; alles daarbuiten wordt op de API-grens geweigerd (400). */
export const SPEECH_VOICE_IDS = SPEECH_VOICE_CATALOG.map((voice) => voice.id) as [
  string,
  ...string[],
];

/** Stem-id; onbekende waarden worden op de API-grens geweigerd (400). */
export const speechVoiceSchema = z.enum(SPEECH_VOICE_IDS);
export type SpeechVoiceId = z.infer<typeof speechVoiceSchema>;

/** De id van de apparaatstem: geen model, maar "laat de tablet het zelf doen". */
export const DEVICE_SPEECH_VOICE = 'device';

/** De standaardstem: een rustige Nederlandse mannenstem, gesynthetiseerd door de server. */
export const DEFAULT_SPEECH_VOICE: SpeechVoiceId = 'nl_NL-pim-medium';

/** Spreekt de tablet deze stem zelf uit (dan is er geen spraakdienst nodig)? */
export function isDeviceVoice(voice: string): boolean {
  return voice === DEVICE_SPEECH_VOICE;
}

/**
 * Normaliseert een **opgeslagen** stem-id: onbekend → de standaard. Dezelfde tweedeling als bij de
 * gespreksstrategie: invoer wordt hard geweigerd, opgeslagen data wordt gerepareerd. Verdwijnt een stem
 * ooit uit de catalogus, dan mag het profiel van die gebruiker daardoor niet onleesbaar worden — dan
 * zou hij zijn tablet niet meer kunnen gebruiken om iets te zeggen.
 */
export function toSpeechVoice(value: unknown): SpeechVoiceId {
  const parsed = speechVoiceSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SPEECH_VOICE;
}

/**
 * Maximale lengte (tekens) van een uit te spreken tekst. Ruim boven een AAC-boodschap of een vraag,
 * streng genoeg om de spraakdienst niet als tekst-naar-audio-machine te laten misbruiken.
 */
export const SPEECH_MAX_TEXT_LENGTH = 300;

/**
 * Verzoek om een tekst uit te spreken (`POST /device/speech`). De stem komt uit het profiel van de
 * gebruiker achter de apparaatsessie — de tablet kiest die dus **niet** zelf.
 */
export const speakRequestSchema = z.object({
  text: z.string().trim().min(1).max(SPEECH_MAX_TEXT_LENGTH),
});
export type SpeakRequest = z.infer<typeof speakRequestSchema>;

/**
 * Voorbeeldverzoek voor de beheeromgeving (`POST /users/{id}/speech-preview`): dezelfde tekst, maar met
 * een **expliciete** stem, zodat de begeleider stemmen kan vergelijken zonder de instelling al op te
 * slaan.
 */
export const speechPreviewRequestSchema = speakRequestSchema.extend({
  voice: speechVoiceSchema,
});
export type SpeechPreviewRequest = z.infer<typeof speechPreviewRequestSchema>;

/** De voorbeeldzin bij de stemkeuze: een boodschap zoals de gebruiker hem zou zeggen. */
export const SPEECH_PREVIEW_SENTENCE = 'Ik wil graag water drinken.';

/**
 * De ingebouwde **vraagstrategieën** (INTENTO-NEW-DESIGN §7.1): een instructie die de Question Agent
 * meekrijgt. De sleutels zijn stabiel en gelijk aan die in de agentdienst (contracttest, N6.4). Een
 * strategie verandert de manier van vragen, nooit de garanties (§52).
 */
export const QUESTION_STRATEGY_KEYS = [
  'general_to_specific',
  'concrete_first',
  'short_and_calm',
] as const;
export const questionStrategySchema = z.enum(QUESTION_STRATEGY_KEYS);
export type QuestionStrategy = z.infer<typeof questionStrategySchema>;

/** De keuzelijst zoals de begeleider of beheerder hem ziet: naam en uitleg in begrijpelijke taal. */
export const QUESTION_STRATEGY_CATALOG: readonly {
  key: QuestionStrategy;
  label: string;
  description: string;
}[] = [
  {
    key: 'general_to_specific',
    label: 'Van algemeen naar specifiek',
    description:
      'Eerst het onderwerp ("Heb je pijn?"), daarna de details ("Aan je hoofd?"). Geschikt voor wie ' +
      'het prettig vindt om stap voor stap te kiezen. De standaard.',
  },
  {
    key: 'concrete_first',
    label: 'Concreet eerst',
    description:
      'Meteen naar concrete dingen ("Wil je water?") en abstracte tussenstappen overslaan. Geschikt voor ' +
      'wie voorwerpen goed herkent maar moeite heeft met categorieën.',
  },
  {
    key: 'short_and_calm',
    label: 'Kort en rustig',
    description:
      'Korte, eenvoudige vragen, één ding tegelijk; liever een vraag meer dan een moeilijke vraag. ' +
      'Geschikt voor wie snel overprikkeld raakt of veel tijd nodig heeft.',
  },
];

/** De vorm van een gesprek (§11, §50): binary, multi-icon, of laat de AI kiezen. */
export const INTERACTION_MODES = ['binary', 'multi', 'ai'] as const;
export const interactionModeSettingKeySchema = z.enum(INTERACTION_MODES);
export type InteractionModeSetting = z.infer<typeof interactionModeSettingKeySchema>;

/** De grenzen uit §50. */
export const OPTIONS_PER_SCREEN_MIN = 2;
export const OPTIONS_PER_SCREEN_MAX = 8;
export const MAX_QUESTIONS_MIN = 5;
export const MAX_QUESTIONS_MAX = 30;

/**
 * Communicatie-instellingen van een gebruiker (`UserCommunicationProfile`, INTENTO-NEW-DESIGN §50).
 */
export const communicationProfileSchema = z.object({
  /** Vorm van het gesprek: `binary` (standaard), `multi` (multi-icon) of `ai` (AI kiest). */
  interactionMode: interactionModeSettingKeySchema,
  /** Opties per scherm in multi-icon, 2–8 (standaard 4). */
  optionsPerScreen: z.number().int().min(OPTIONS_PER_SCREEN_MIN).max(OPTIONS_PER_SCREEN_MAX),
  /** Hoe de AI vraagt (§7.1); standaard `general_to_specific`. */
  questionStrategy: questionStrategySchema,
  /** Leert Intento van deze gebruiker (§22)? Standaard aan; uit = niets opbouwen en niets gebruiken. */
  experienceEnabled: z.boolean(),
  /** Maximum aantal vragen per gesprek (§10, S1), 5–30 (standaard 15). */
  maxQuestions: z.number().int().min(MAX_QUESTIONS_MIN).max(MAX_QUESTIONS_MAX),
  /** Tekst onder de pictogrammen tonen. */
  showText: z.boolean(),
  /**
   * Spreekt de tablet uit wat er op het scherm staat? Standaard **uit**: een tablet die
   * onaangekondigd begint te praten is voor deze doelgroep geen kleinigheid.
   */
  speechEnabled: z.boolean(),
  /** De stem waarmee dat gebeurt; de begeleider kiest hem op gehoor. */
  speechVoice: speechVoiceSchema,
});
export type CommunicationProfile = z.infer<typeof communicationProfileSchema>;

/** Publieke weergave van een gebruiker inclusief communicatieprofiel. */
export const userPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  organizationId: z.string(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  communicationProfile: communicationProfileSchema,
});
export type UserPublic = z.infer<typeof userPublicSchema>;

/**
 * Aanmaakverzoek (`POST /users`). Alleen een naam is nodig; het communicatieprofiel wordt
 * met de standaardwaarden aangemaakt en daarna via `PUT /users/{id}/settings` aangepast.
 * `active` is optioneel (standaard actief).
 */
export const createUserRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  active: z.boolean().optional(),
  /**
   * Experience (§22, V2): standaard aan. Bij het aanmaken staat de keuze zichtbaar in beeld, zodat de
   * beheerder bewust kiest.
   */
  experienceEnabled: z.boolean().optional(),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/**
 * Instellingenverzoek (`PUT /users/{id}/settings`). PUT vervangt het volledige profiel, dus
 * alle velden zijn verplicht.
 */
export const updateSettingsRequestSchema = communicationProfileSchema;
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

/** Antwoord op `GET /admin/users`: gebruikers **binnen de eigen organisatie** (tenant-gefilterd). */
export const userListResponseSchema = z.object({
  users: z.array(userPublicSchema),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

// --- Profielexport/-import (INTENTO-NEW-DESIGN §53, §51) ---

/**
 * Huidige versie van het profielexportformaat. Reist mee in de payload zodat een importeur een ouder/
 * nieuwer formaat kan herkennen en weigeren i.p.v. verkeerd te interpreteren (ruimte voor migratie later).
 */
export const PROFILE_EXPORT_VERSION = 1;

/**
 * De **ontsleutelde** inhoud van een profielexport (INTENTO-NEW-DESIGN §53). Bevat uitsluitend het
 * gebruikersprofiel: naam en communicatie-instellingen (contacten en Experience volgen in N15.1).
 * Bewust **niet**: account- of organisatiegegevens, id's of tokens — het profiel is eigendom van de
 * gebruiker en draagbaar naar een andere omgeving. Deze payload wordt in zijn geheel versleuteld voordat
 * hij het bestand in gaat (`profileExportResponseSchema.data`).
 */
export const profileExportSchema = z.object({
  version: z.literal(PROFILE_EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  user: z.object({ name: z.string() }),
  /**
   * Het communicatieprofiel. De spraakinstellingen hebben een terugval: een ouder bestand zonder die
   * velden is geen reden om een overdracht te weigeren. Velden van vóór de herbouw (N0.5) worden bij
   * het inlezen genegeerd.
   */
  communicationProfile: communicationProfileSchema.extend({
    interactionMode: interactionModeSettingKeySchema.default('binary'),
    optionsPerScreen: z
      .number()
      .int()
      .min(OPTIONS_PER_SCREEN_MIN)
      .max(OPTIONS_PER_SCREEN_MAX)
      .default(4),
    questionStrategy: questionStrategySchema.default('general_to_specific'),
    experienceEnabled: z.boolean().default(true),
    maxQuestions: z.number().int().min(MAX_QUESTIONS_MIN).max(MAX_QUESTIONS_MAX).default(15),
    speechEnabled: z.boolean().default(false),
    speechVoice: speechVoiceSchema.default(DEFAULT_SPEECH_VOICE),
  }),
});
export type ProfileExport = z.infer<typeof profileExportSchema>;

/**
 * Antwoord op `GET /users/{id}/export`. `data` is de **versleutelde** (ondoorzichtige) export-payload —
 * onleesbaar zonder de omgevingssleutel (`ENCRYPTION_KEY`) — die de beheer-UI als bestand laat downloaden.
 * `filename` is een suggestie voor de downloadnaam.
 */
export const profileExportResponseSchema = z.object({
  data: z.string().min(1),
  filename: z.string().min(1),
});
export type ProfileExportResponse = z.infer<typeof profileExportResponseSchema>;

/**
 * Verzoek voor `POST /users/import`. `data` is de eerder geëxporteerde, versleutelde payload; de server
 * ontsleutelt en valideert 'm en maakt er een **nieuwe** gebruiker mee aan in de eigen organisatie. `name`
 * overschrijft optioneel de weergavenaam uit de export (standaard de geëxporteerde naam).
 */
export const profileImportRequestSchema = z.object({
  data: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
});
export type ProfileImportRequest = z.infer<typeof profileImportRequestSchema>;

// --- Begeleiders koppelen (INTENTO-NEW-DESIGN §49) ---

/**
 * Eén begeleider-account in de koppelweergave van een gebruiker (`GET /admin/users/{id}/caregivers`).
 * `linked` geeft aan of dit CAREGIVER-account op dít moment aan de gebruiker gekoppeld is,
 * zodat de beheer-UI per begeleider een aan/uit-schakelaar kan tonen.
 */
export const caregiverLinkSchema = z.object({
  accountId: z.string(),
  email: z.email(),
  linked: z.boolean(),
  /**
   * De rol van het account. Een **beheerder mag ook begeleider zijn**: een ADMIN kan aan een
   * gebruiker gekoppeld worden en verschijnt daarom in deze lijst. De rol reist mee zodat de UI zichtbaar
   * houdt wie beheerder is en wie 'gewone' begeleider.
   */
  role: accountRoleSchema,
});
export type CaregiverLink = z.infer<typeof caregiverLinkSchema>;

/**
 * Antwoord op `GET /admin/users/{id}/caregivers`: alle accounts van de eigen organisatie die
 * begeleider kunnen zijn (CAREGIVER **en** ADMIN — T9.1), met per account of het aan deze gebruiker
 * gekoppeld is (tenant-gefilterd).
 */
export const caregiverListResponseSchema = z.object({
  caregivers: z.array(caregiverLinkSchema),
});
export type CaregiverListResponse = z.infer<typeof caregiverListResponseSchema>;

/**
 * Koppelverzoek (`POST /admin/users/{id}/caregivers`). Eén endpoint voor koppelen én
 * ontkoppelen: `linked: true` legt de koppeling, `linked: false` verwijdert die. Idempotent —
 * herhaald koppelen/ontkoppelen levert dezelfde eindtoestand. `accountId` moet een CAREGIVER- of
 * ADMIN-account binnen dezelfde organisatie zijn (afgedwongen op de server).
 */
export const linkCaregiverRequestSchema = z.object({
  accountId: z.string().min(1),
  linked: z.boolean(),
});
export type LinkCaregiverRequest = z.infer<typeof linkCaregiverRequestSchema>;

// --- Tabletkoppeling / apparaten (INTENTO-NEW-DESIGN §39, §51) ---

/**
 * Antwoord op `POST /admin/users/{id}/device-code`: de zojuist gegenereerde koppelcode en het
 * moment waarop die verloopt. De **plaintext** code wordt hier één keer teruggegeven zodat de
 * beheerder 'm op de tablet kan invoeren; daarna kent de server alleen nog de hash (de code is
 * niet opnieuw op te vragen). De code is eenmalig en verloopt.
 */
export const deviceCodeResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.iso.datetime(),
});
export type DeviceCodeResponse = z.infer<typeof deviceCodeResponseSchema>;

/**
 * Koppelverzoek van de tablet (`POST /devices/link`). Wisselt een koppelcode in voor een
 * langlevend apparaat-token. De code wordt genormaliseerd (hoofdletters, scheidingstekens en
 * spaties verwijderd) zodat invoervarianten als "abcd-efgh" of "ABCD EFGH" gelijk behandeld
 * worden. Dit endpoint is bewust **niet** ingelogd (de tablet heeft nog geen sessie) en streng
 * rate-limited op de server tegen het raden van codes.
 */
export const linkDeviceRequestSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .transform((value) => value.replace(/[\s-]/g, '').toUpperCase()),
});
export type LinkDeviceRequest = z.infer<typeof linkDeviceRequestSchema>;

/** Publieke weergave van een gekoppeld apparaat (nooit het token of de hash). */
export const devicePublicSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.string(),
  lastActive: z.iso.datetime(),
});
export type DevicePublic = z.infer<typeof devicePublicSchema>;

/**
 * Apparaat-sessieweergave (`POST /devices/link` en `GET /device/me`): het gekoppelde apparaat
 * plus de gebruiker waaraan het gebonden is (met communicatieprofiel). Dit is alles waartoe een
 * apparaat-token toegang geeft — de eigen gebruiker, nooit andere gebruikers of beheerdata.
 */
export const deviceSessionResponseSchema = z.object({
  device: devicePublicSchema,
  user: userPublicSchema,
});
export type DeviceSessionResponse = z.infer<typeof deviceSessionResponseSchema>;

// --- OpenSymbols-integratie (INTENTO-NEW-DESIGN §39, §51) ---

/**
 * Een `https`-URL. Bewust géén `http`/`data:`/andere schema's: die zijn ofwel onveilig als
 * afbeeldingsbron (XSS via `javascript:`/`data:`) of ongeschikt (SSRF/plain-HTTP). Bron- en
 * licentie-URL's van externe pictogrammen moeten altijd `https` zijn (T3.3-veiligheidseis).
 */
export const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => /^https:\/\//i.test(value), {
    message: 'Alleen https-URL’s zijn toegestaan.',
  });

/**
 * Zoekverzoek tegen de OpenSymbols-proxy (`GET /admin/aac/opensymbols/search?q=…`). De backend
 * praat namens de client met OpenSymbols (INTENTO-NEW-DESIGN §51, de client nooit rechtstreeks). `locale`
 * stuurt de taal van de zoekresultaten (standaard Nederlands).
 */
export const openSymbolsSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  locale: z
    .string()
    .trim()
    .regex(/^[a-z]{2}$/i, 'Locale is een tweeletterige taalcode.')
    .optional(),
});
export type OpenSymbolsSearchQuery = z.infer<typeof openSymbolsSearchQuerySchema>;

/**
 * Een attributie-/verwijzings-URL (licentie, auteur, bron). Anders dan `httpsUrlSchema` mag hier
 * ook `http`: dit zijn geen afbeeldingsbronnen die de server ophaalt, maar links die een beheerder
 * kan aanklikken — en externe pictogrambibliotheken publiceren hun licentie- en auteurspagina's nog
 * volop op plain `http`. Alle andere schema's blijven geweigerd: `javascript:`/`data:` in een `href`
 * is XSS (CLAUDE.md security-checklist: `http(s)`-only).
 */
export const webLinkUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'Alleen http(s)-URL’s zijn toegestaan.',
  });

/**
 * Eén (reeds gesaneerd) OpenSymbols-zoekresultaat zoals de backend het aan de beheer-UI teruggeeft.
 * `imageUrl` is gegarandeerd een `https`-URL (anders is het resultaat door de proxy weggelaten).
 * De licentie-/bronvelden gaan bij een import mee naar het Vocabulary-item (attributie).
 */
export const openSymbolsResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageUrl: httpsUrlSchema,
  extension: z.string(),
  license: z.string(),
  licenseUrl: webLinkUrlSchema.nullable(),
  author: z.string().nullable(),
  authorUrl: webLinkUrlSchema.nullable(),
  sourceUrl: webLinkUrlSchema.nullable(),
});
export type OpenSymbolsResult = z.infer<typeof openSymbolsResultSchema>;

/** Antwoord op de OpenSymbols-zoekproxy: de gesaneerde resultaten (niet tenant-gebonden). */
export const openSymbolsSearchResponseSchema = z.object({
  results: z.array(openSymbolsResultSchema),
});
export type OpenSymbolsSearchResponse = z.infer<typeof openSymbolsSearchResponseSchema>;

// --- Beheerdashboard ---

/**
 * Antwoord op `GET /admin/dashboard`: een beknopt overzicht van de **eigen organisatie** (gebruikers en
 * begeleiders). De tellingen zijn tenant-gefilterd (`organizationId`).
 */
export const dashboardResponseSchema = z.object({
  users: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
  }),
  caregivers: z.object({
    total: z.number().int().nonnegative(),
  }),
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

// --- Audit-log (INTENTO-NEW-DESIGN §53) ---

/** Uitkomst van een geauditeerde actie: geslaagd of mislukt (bv. een mislukte login). */
export const auditOutcomeSchema = z.enum(['success', 'failure']);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

/**
 * Publieke weergave van één audit-regel (INTENTO-NEW-DESIGN §53, `GET /admin/audit-logs`). Een append-only
 * spoor van gevoelige acties zonder communicatie-inhoud: alleen een stabiele `action`-sleutel, de
 * uitkomst, de actor en objectverwijzingen. `metadata` bevat hoogstens kleine, niet-gevoelige context.
 */
export const auditLogEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  outcome: auditOutcomeSchema,
  accountId: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/** Antwoord op `GET /admin/audit-logs`: recente audit-regels van de **eigen** organisatie (nieuwste eerst). */
export const auditLogListResponseSchema = z.object({
  entries: z.array(auditLogEntrySchema),
});
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;

// --- Platform-operatorconsole (INTENTO-NEW-DESIGN §53) ---

/**
 * Publieke weergave van één organisatie in de **operatorconsole** (`GET /operator/organizations`).
 *
 * Dit is de enige plek in Intento waar data van meerdere tenants naast elkaar staat, dus de vorm is
 * bewust smal: alleen **beheermetadata** (naam, soort, status, omvang). Geen communicatie-inhoud,
 * geen persoonlijke context, geen gebruikersnamen — die blijven binnen de tenant (INTENTO-NEW-DESIGN §53).
 * `userCount`/`accountCount` zijn aggregaten: een operator kan de omvang van een omgeving inschatten
 * (misbruik, capaciteit) zonder de mensen erin te zien.
 */
export const operatorOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: organizationTypeSchema,
  /** Actief; `false` = door een operator gedeactiveerd (login/sessies/tablets geweigerd). */
  active: z.boolean(),
  /** Platformorganisatie: hier wonen de operators. */
  isPlatform: z.boolean(),
  userCount: z.number().int().nonnegative(),
  accountCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type OperatorOrganization = z.infer<typeof operatorOrganizationSchema>;

/** Antwoord op `GET /operator/organizations`: alle organisaties (nieuwste eerst). */
export const operatorOrganizationListResponseSchema = z.object({
  organizations: z.array(operatorOrganizationSchema),
});
export type OperatorOrganizationListResponse = z.infer<
  typeof operatorOrganizationListResponseSchema
>;

/**
 * Nieuwe organisatie aanmaken vanuit de console (`POST /operator/organizations`). Bewust **zonder**
 * eerste admin-account: een omgeving krijgt haar beheerder via zelfaanmelding of via de
 * ADMIN-flow binnen de tenant. De operator zet dus de omgeving neer, maar mint geen
 * inloggegevens voor andermans tenant — dat zou een operator stilzwijgend toegang tot communicatie
 * geven. Zie docs/security.md.
 */
export const createOperatorOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: organizationTypeSchema,
});
export type CreateOperatorOrganizationRequest = z.infer<
  typeof createOperatorOrganizationRequestSchema
>;

/**
 * Accountregel in het organisatiedetail van de console (`GET /operator/organizations/:id`).
 *
 * Alleen wat nodig is om misbruik of een vastgelopen omgeving te beoordelen: wie kan er inloggen,
 * met welke rol, en is dat account al bevestigd/overgestapt van zijn tijdelijke wachtwoord. Nooit
 * de wachtwoordhash, sessies, of iets uit de communicatie.
 */
export const operatorAccountSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string().nullable(),
  role: accountRoleSchema,
  emailVerified: z.boolean(),
  mustChangePassword: z.boolean(),
  isOperator: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type OperatorAccount = z.infer<typeof operatorAccountSchema>;

/**
 * Gebruikersregel in het organisatiedetail. **Zonder naam**: de communicerende persoon is de meest
 * beschermde entiteit in Intento (INTENTO-NEW-DESIGN §49, §53) en een operator hoeft voor beheer alleen te weten
 * dát er gebruikers zijn en of ze actief zijn — niet wie. Vandaar id + status + aanmaakmoment.
 */
export const operatorUserSchema = z.object({
  id: z.string(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type OperatorUser = z.infer<typeof operatorUserSchema>;

/** Antwoord op `GET /operator/organizations/:id`: de organisatie met haar accounts en gebruikers. */
export const operatorOrganizationDetailSchema = z.object({
  organization: operatorOrganizationSchema,
  accounts: z.array(operatorAccountSchema),
  users: z.array(operatorUserSchema),
});
export type OperatorOrganizationDetail = z.infer<typeof operatorOrganizationDetailSchema>;

// --- Vocabulary (INTENTO-NEW-DESIGN §15, §49) ---

export const vocabularyStatusSchema = z.enum(['approved', 'retired']);
export type VocabularyStatus = z.infer<typeof vocabularyStatusSchema>;
export const labelStatusSchema = z.enum(['reviewed', 'machine']);
export type LabelStatus = z.infer<typeof labelStatusSchema>;
export const vocabularySourceSchema = z.enum(['seed', 'external', 'own']);
export type VocabularySource = z.infer<typeof vocabularySourceSchema>;

/** Query van `GET /vocabulary`: zoeken, filteren op status, pagineren. */
export const vocabularyListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: vocabularyStatusSchema.default('approved'),
  labelStatus: labelStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type VocabularyListQuery = z.infer<typeof vocabularyListQuerySchema>;

/** Licentie en herkomst van één item (§15): wat de bronvermelding nodig heeft. */
export const vocabularyLicenseSchema = z.object({
  key: z.string(),
  url: webLinkUrlSchema.nullable(),
  author: z.string().nullable(),
  authorUrl: webLinkUrlSchema.nullable(),
  sourceName: z.string().nullable(),
  sourceUrl: webLinkUrlSchema.nullable(),
  sourceRef: z.string().nullable(),
  importedAt: z.iso.datetime().nullable(),
});
export type VocabularyLicense = z.infer<typeof vocabularyLicenseSchema>;

/** Eén Vocabulary-item zoals de beheeromgeving het ziet, met een ondertekende afbeeldings-URL. */
export const vocabularyItemPublicSchema = z.object({
  id: z.string(),
  /** `platform` (startset, voor iedereen) of `organization` (van de eigen organisatie). */
  scope: z.enum(['platform', 'organization']),
  labels: z.array(z.string()).min(1),
  concepts: z.array(z.string()).min(1),
  contexts: z.array(z.string()),
  partOfSpeech: z.string().nullable(),
  isStart: z.boolean(),
  sortOrder: z.number().int(),
  status: vocabularyStatusSchema,
  labelStatus: labelStatusSchema,
  source: vocabularySourceSchema,
  license: vocabularyLicenseSchema,
  /** Relatieve, ondertekende URL (`/assets/…`); `null` zonder afbeelding of bij een ingetrokken item. */
  imageUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type VocabularyItemPublic = z.infer<typeof vocabularyItemPublicSchema>;

export const vocabularyListResponseSchema = z.object({
  items: z.array(vocabularyItemPublicSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type VocabularyListResponse = z.infer<typeof vocabularyListResponseSchema>;

/** De vaste contexten van de Vocabulary (§15.1): gezondheid, eten en drinken, gevoelens, … */
export const VOCABULARY_CONTEXTS = [
  'health',
  'food_drink',
  'feelings',
  'body',
  'people',
  'places',
  'activities',
  'things',
  'time',
  'other',
] as const;
export const vocabularyContextSchema = z.enum(VOCABULARY_CONTEXTS);
export type VocabularyContext = z.infer<typeof vocabularyContextSchema>;

/** Een taalneutrale conceptsleutel: kleine letters, cijfers en underscores (`chest_pain`). */
export const conceptKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, 'Een concept bestaat uit kleine letters, cijfers en _.')
  .max(60);

const vocabularyLabelSchema = z.string().trim().min(1).max(60);

/**
 * Bewerken van een item (`PATCH /vocabulary/{id}`, §15, §16): labels (het eerste is het hoofdlabel, de
 * rest synoniemen), concepten, contexten, startconcept en volgorde. Minstens één veld.
 */
export const vocabularyUpdateRequestSchema = z
  .strictObject({
    labels: z
      .array(vocabularyLabelSchema)
      .min(1)
      .max(20)
      .refine((list) => new Set(list.map((l) => l.toLowerCase())).size === list.length, {
        message: 'Elk label mag maar één keer voorkomen.',
      })
      .optional(),
    concepts: z
      .array(conceptKeySchema)
      .min(1)
      .max(10)
      .refine((list) => new Set(list).size === list.length, {
        message: 'Elk concept mag maar één keer voorkomen.',
      })
      .optional(),
    contexts: z
      .array(vocabularyContextSchema)
      .max(VOCABULARY_CONTEXTS.length)
      .refine((list) => new Set(list).size === list.length, {
        message: 'Elke context mag maar één keer voorkomen.',
      })
      .optional(),
    isStart: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Geef minstens één veld om te wijzigen.',
  });
export type VocabularyUpdateRequest = z.infer<typeof vocabularyUpdateRequestSchema>;

/** Eén bron in de bronvermelding (`GET /vocabulary/attributions`, §15): wie, welke licentie, welke symbolen. */
export const attributionSourceSchema = z.object({
  sourceName: z.string(),
  sourceUrl: webLinkUrlSchema.nullable(),
  licenseKey: z.string(),
  licenseUrl: webLinkUrlSchema.nullable(),
  author: z.string().nullable(),
  authorUrl: webLinkUrlSchema.nullable(),
  /** Of deze licentie naamsvermelding vraagt (CC BY en afgeleiden). */
  requiresAttribution: z.boolean(),
  items: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type AttributionSource = z.infer<typeof attributionSourceSchema>;

export const attributionListResponseSchema = z.object({
  sources: z.array(attributionSourceSchema),
});
export type AttributionListResponse = z.infer<typeof attributionListResponseSchema>;

// --- Organisatie-instellingen (INTENTO-NEW-DESIGN §50, §53) ---

export const RETENTION_DAYS_MIN = 7;
export const RETENTION_DAYS_MAX = 365;

/** `GET /organization/settings`: de geldende bewaartermijn, en of die de standaard is. */
export const organizationSettingsSchema = z.object({
  retentionDays: z.number().int().min(RETENTION_DAYS_MIN).max(RETENTION_DAYS_MAX),
  /** De standaard van deze installatie (`RETENTION_DEFAULT_DAYS`). */
  retentionDaysDefault: z.number().int().min(RETENTION_DAYS_MIN).max(RETENTION_DAYS_MAX),
  /** `true` als de organisatie zelf geen termijn koos en de standaard geldt. */
  usesDefault: z.boolean(),
});
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

/** `PUT /organization/settings`: een eigen termijn, of `null` om de standaard te volgen. */
export const updateOrganizationSettingsSchema = z.strictObject({
  retentionDays: z.number().int().min(RETENTION_DAYS_MIN).max(RETENTION_DAYS_MAX).nullable(),
});
export type UpdateOrganizationSettings = z.infer<typeof updateOrganizationSettingsSchema>;
