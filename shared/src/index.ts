import { z } from 'zod';

/**
 * Gedeelde zod-schema's en types tussen server en web.
 *
 * Bron van waarheid voor de vorm van API-payloads. Zowel de server (validatie +
 * response-typing) als de web-client (fetch-typing) importeren hieruit, zodat
 * client en server nooit uit elkaar lopen.
 */

/** Consistente foutstructuur (DESIGN §8.1): `{ error: { code, message } }`. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * Uitbreiding van de foutstructuur bij backpressure van de gedistribueerde AI-wachtrij
 * (T5.5/T5.7, ADR-0010). De 503 `AI_WORKER_BUSY`/`AI_WORKER_UNAVAILABLE`-respons draagt naast
 * `error` een voorgestelde wachttijd (`retryAfterMs`, spiegelt de `Retry-After`-header) en — bij
 * een volle wachtrij — de positie in de rij mee. De tablet-UI gebruikt dit om rustig te wachten
 * en de laatste gespreks-actie automatisch opnieuw te pollen tot een worker antwoordt (T5.7).
 */
export const aiWaitingErrorSchema = apiErrorSchema.extend({
  waiting: z.boolean().optional(),
  position: z.number().int().positive().optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
});
export type AiWaitingError = z.infer<typeof aiWaitingErrorSchema>;

/** Antwoord van het health-endpoint. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('intento-server'),
  timestamp: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Rollen van een account (DESIGN §2). Ook de bron voor de db-validatie op de grens. */
export const accountRoleSchema = z.enum(['ADMIN', 'CAREGIVER', 'USER']);
export type AccountRole = z.infer<typeof accountRoleSchema>;

/**
 * Soort omgeving (`Organization.type`, DESIGN §6.2): een familie, een zorginstelling of een
 * persoonlijke omgeving. Bewust een gesloten lijst — gevalideerd op de API-grens (geen native
 * enum i.v.m. SQLite/PostgreSQL-portabiliteit). Een ongeldige waarde levert een 400.
 */
export const organizationTypeSchema = z.enum(['family', 'care', 'personal']);
export type OrganizationType = z.infer<typeof organizationTypeSchema>;

/**
 * Wachtwoordsterkte-eis bij het aanmaken van een account (zelfaanmelding, T1.3). Bewust
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
 * Registratieverzoek (`POST /auth/register`, T1.3, DESIGN §2, §3.7 stap 1). Een nieuwe bezoeker
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
   * Of het e-mailadres is geverifieerd (T1.4). Onbevestigde accounts mogen inloggen, maar
   * bepaalde gevoelige acties zijn geblokkeerd tot verificatie; de web-UI toont hierop een
   * herinnerings-banner met een "opnieuw versturen"-knop.
   */
  emailVerified: z.boolean(),
  /**
   * Of dit account nog op het **tijdelijke** wachtwoord zit dat de server bij het aanmaken (T2.4)
   * genereerde en aan de beheerder toonde (T2.6). Zolang dit `true` is kent een tweede persoon het
   * wachtwoord; de server staat dan alléén `GET /auth/me` en `POST /auth/password` toe en de
   * web-UI toont de houder een blokkerend "kies eerst een eigen wachtwoord"-scherm. In de
   * accountlijst van de beheerder verschijnt het als markering, zodat zichtbaar is wie nog niet
   * is overgestapt. Zelf gekozen wachtwoorden (zelfaanmelding T1.3, seed) zijn nooit gemarkeerd.
   */
  mustChangePassword: z.boolean(),
  /**
   * Of dit account de **platform-operatorconsole** mag gebruiken (T8.3). Bewust géén rol maar een
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

// --- Eigen wachtwoord wijzigen (T2.5, DESIGN §2, §6.2 Account, §9.4) ---

/**
 * Verzoek om het **eigen** wachtwoord te wijzigen (`POST /auth/password`, T2.5). Er zit bewust
 * géén account-id in: de server pakt altijd het ingelogde account uit de sessie, zodat niemand
 * via de body het wachtwoord van een ander kan zetten.
 *
 * `currentPassword` is verplicht (her-authenticatie: een gekaapte sessie of een onbeheerd
 * apparaat kan het wachtwoord niet zomaar overnemen) en wordt — net als bij login — alleen op
 * niet-leeg gevalideerd; sterkte-eisen gelden voor het **nieuwe** wachtwoord. De extra `refine`
 * weigert "wijzigen" naar hetzelfde wachtwoord: dat zou de sessies van dit account intrekken
 * zonder dat er iets verandert, en is bij een tijdelijk wachtwoord (T2.4) juist niet de bedoeling.
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

// --- E-mailverificatie (T1.4, DESIGN §2, §3.7 stap 1, §9.4) ---

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
 * andere organisatie (DESIGN §9.4, multi-tenant-isolatie).
 */
export const accountListResponseSchema = z.object({
  accounts: z.array(accountPublicSchema),
});
export type AccountListResponse = z.infer<typeof accountListResponseSchema>;

/**
 * Aanmaakverzoek voor een **begeleider-account** (`POST /admin/accounts`, T2.4, DESIGN §2, §5.2,
 * FR-017). Bewust **zonder rolveld**: de server zet de rol hard op `CAREGIVER` en de organisatie op
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
 * wachtwoord**. Dat wachtwoord is server-gegenereerd en wordt hier — net als een koppelcode (T2.3)
 * of een worker-token (T5.8) — **één keer** teruggegeven; in de db staat alleen de argon2id-hash,
 * dus het is daarna niet meer op te vragen. De beheerder geeft het via een veilig kanaal aan de
 * begeleider door.
 */
export const createCaregiverResponseSchema = z.object({
  account: accountPublicSchema,
  temporaryPassword: z.string(),
});
export type CreateCaregiverResponse = z.infer<typeof createCaregiverResponseSchema>;

/**
 * Antwoord van `POST /admin/accounts/{id}/password` (T2.7, DESIGN §2, §6.2 Account, §9.4): een
 * beheerder geeft een **nieuw** server-gegenereerd tijdelijk wachtwoord uit voor een account in de
 * eigen organisatie dat is vastgelopen — het tijdelijke wachtwoord uit T2.4 kwijt, of buitengesloten
 * door de lockout. Zonder deze actie is er geen weg terug: inloggen lukt niet en zonder sessie is
 * `POST /auth/password` (T2.5) onbereikbaar.
 *
 * Zelfde eigenschappen als bij aanmaken (T2.4): het wachtwoord is server-gegenereerd, wordt hier
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

// --- Gebruikers en communicatieprofiel (T2.1, DESIGN §2, §5.3, §6.2) ---

/**
 * Aantal pictogramopties per scherm. Bewust beperkt tot 2/4/6/8 (DESIGN §5.3): minder =
 * eenvoudiger, meer = sneller. Elke andere waarde is ongeldig en wordt op de API-grens
 * geweigerd (400). Standaardwaarde is 4 (in het datamodel).
 */
export const iconsPerScreenSchema = z.union([
  z.literal(2),
  z.literal(4),
  z.literal(6),
  z.literal(8),
]);
export type IconsPerScreen = z.infer<typeof iconsPerScreenSchema>;

/**
 * De sleutels van de ingebouwde **gespreksstrategieën** (T11.4, DESIGN §7.10). Stabiel: ze worden
 * opgeslagen bij de gebruiker en het gesprek, en verschijnen in logs en beheerschermen.
 *
 * Ze staan hier — in `shared` — omdat zowel de server (die de parameters kent) als de beheer-UI (die de
 * keuze toont) dezelfde lijst nodig heeft. De **parameters** van een strategie blijven server-intern:
 * de client hoeft niet te weten met welke drempels er gezocht wordt, alleen wát hij kan kiezen.
 */
export const CONVERSATION_STRATEGY_KEYS = ['refine', 'explore', 'calm', 'context-first'] as const;

/** Strategiesleutel; een onbekende waarde wordt op de API-grens geweigerd (400). */
export const conversationStrategySchema = z.enum(CONVERSATION_STRATEGY_KEYS);
export type ConversationStrategyKey = z.infer<typeof conversationStrategySchema>;

/** De standaardstrategie: de aanpak die gold voordat er iets te kiezen viel. */
export const DEFAULT_CONVERSATION_STRATEGY: ConversationStrategyKey = 'refine';

/**
 * Normaliseert een **opgeslagen** strategiesleutel: onbekend → de standaard.
 *
 * De twee kanten zijn bewust verschillend. *Invoer* wordt hard geweigerd (`conversationStrategySchema`
 * op de API-grens, 400): een half toegepaste strategie is erger dan een geweigerde request. *Opgeslagen*
 * data wordt gerepareerd: verdwijnt een strategie ooit uit de registry, dan mag het profiel van die
 * gebruiker daardoor niet onleesbaar worden — hij zou zijn tablet niet meer kunnen koppelen om iets te
 * zeggen. Dat is een veel groter kwaad dan een aanpak die stilletjes terugvalt op de standaard.
 */
export function toConversationStrategy(value: unknown): ConversationStrategyKey {
  const parsed = conversationStrategySchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CONVERSATION_STRATEGY;
}

/**
 * De keuzelijst zoals de **begeleider** hem ziet: naam en uitleg in begrijpelijke taal, geen
 * parameters. Eén bron voor de beheer-UI en de server-registry, zodat een strategie nooit onder twee
 * namen rondloopt.
 */
export const CONVERSATION_STRATEGY_CATALOG: readonly {
  key: ConversationStrategyKey;
  label: string;
  description: string;
}[] = [
  {
    key: 'refine',
    label: 'Stap voor stap verfijnen',
    description:
      'Begint bij de categorie en werkt stap voor stap naar het detail toe. De standaardaanpak: ' +
      'geschikt voor wie categorieën herkent en het prettig vindt om in kleine stappen te kiezen.',
  },
  {
    key: 'explore',
    label: 'Breed verkennen',
    description:
      'Laat meteen concrete dingen zien in plaats van eerst categorieën, en toont er meer tegelijk. ' +
      'Geschikt voor wie voorwerpen en activiteiten goed herkent maar moeite heeft met indelen.',
  },
  {
    key: 'calm',
    label: 'Rustig en bevestigend',
    description:
      'Toont weinig pictogrammen tegelijk, blijft dicht bij de vorige keuze en wacht langer voordat ' +
      'er een boodschap wordt voorgesteld. Geschikt voor wie snel overprikkeld raakt of veel tijd ' +
      'nodig heeft.',
  },
  {
    key: 'context-first',
    label: 'Context eerst',
    description:
      'Begint bij wat deze persoon vaak kiest en bij zijn eigen context (personen, favorieten, vaste ' +
      'plekken) in plaats van bij de begrippenboom. Geschikt voor wie een sterk vast dagritme heeft.',
  },
];

/**
 * Communicatie-instellingen van een gebruiker (`UserCommunicationProfile`, DESIGN §5.3).
 * Stuurt de gebruikersapp aan: aantal opties, tekst tonen, AI-leren en ondersteuningsmodus.
 */
export const communicationProfileSchema = z.object({
  iconsPerScreen: iconsPerScreenSchema,
  showText: z.boolean(),
  aiLearningEnabled: z.boolean(),
  supportMode: z.boolean(),
  /**
   * Contextindicator (broodkruimel van het afgelegde pad) in de gebruikersapp tonen (DESIGN §5.3,
   * T2.4). Standaard aan; uit → de tablet toont het gekozen pad niet meer.
   */
  contextIndicator: z.boolean(),
  /**
   * De **gespreksstrategie** van deze gebruiker (T11.4, DESIGN §5.3, §7.10): de manier waarop de AI
   * probeert te achterhalen wat hij bedoelt. Een instelling over de *zoekwijze*, nooit over de
   * waarborgen — geen enkele keuze hier verandert wie eigenaar is van de boodschap.
   */
  conversationStrategy: conversationStrategySchema,
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
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/**
 * Instellingenverzoek (`PUT /users/{id}/settings`). PUT vervangt het volledige profiel, dus
 * alle velden zijn verplicht. `iconsPerScreen` accepteert alléén 2/4/6/8.
 */
export const updateSettingsRequestSchema = communicationProfileSchema;
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

/** Antwoord op `GET /admin/users`: gebruikers **binnen de eigen organisatie** (tenant-gefilterd). */
export const userListResponseSchema = z.object({
  users: z.array(userPublicSchema),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

// --- Persoonlijke context (T6.1, DESIGN §6.2 PersonalContext, §6.3, §9.4, FR-013/020) ---

/**
 * Categorie van een stuk persoonlijke context (DESIGN §6.2). Gesloten taxonomie, op de API-grens
 * gevalideerd — een onbekende categorie levert een 400 (geen native db-enum i.v.m.
 * SQLite/PostgreSQL-portabiliteit). Bepaalt hoe de context de AI ondersteunt (personen, huisdieren,
 * plekken, favorieten, routines …).
 */
export const personalContextCategorySchema = z.enum([
  'PERSON',
  'PET',
  'PLACE',
  'ACTIVITY',
  'FOOD',
  'OBJECT',
  'ROUTINE',
  'OTHER',
]);
export type PersonalContextCategory = z.infer<typeof personalContextCategorySchema>;

/**
 * Aanmaakverzoek (`POST /users/{id}/context`). `name` is de gevoelige, vrij-tekst PII (persoons-/
 * huisdiernaam, favoriet …) en wordt **versleuteld** opgeslagen; `relationship` is een optionele
 * toelichting (bv. "dochter"), eveneens versleuteld. `aiUsageAllowed` is de expliciete toestemming of de
 * AI deze context mag zien (DESIGN §6.3); standaard `false` (opt-in) als het veld ontbreekt.
 */
export const personalContextInputSchema = z.object({
  category: personalContextCategorySchema,
  name: z.string().trim().min(1).max(200),
  relationship: z.string().trim().max(200).optional(),
  aiUsageAllowed: z.boolean().optional(),
});
export type PersonalContextInput = z.infer<typeof personalContextInputSchema>;

/**
 * Publieke weergave van een stuk persoonlijke context (`GET /users/{id}/context`). De gevoelige velden
 * zijn op de server ontsleuteld voordat ze hier terechtkomen; ze verlaten de db nooit plaintext.
 */
export const personalContextPublicSchema = z.object({
  id: z.string(),
  userId: z.string(),
  category: personalContextCategorySchema,
  name: z.string(),
  relationship: z.string().nullable(),
  aiUsageAllowed: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type PersonalContextPublic = z.infer<typeof personalContextPublicSchema>;

/** Antwoord op `GET /users/{id}/context`: alle context van de gebruiker (gebruiker-/tenant-gefilterd). */
export const personalContextListResponseSchema = z.object({
  contexts: z.array(personalContextPublicSchema),
});
export type PersonalContextListResponse = z.infer<typeof personalContextListResponseSchema>;

// --- Voorkeuren / leermechanisme (T6.3, DESIGN §3.8, §6.2 Preference, §7.1 taak 5, FR-014) ---

/**
 * Status van de begeleider-suggestie bij een vaak gekozen concept (DESIGN §3.8). `none` = nog geen
 * suggestie; `pending` = suggestie staat open bij de begeleider; `accepted` = overgenomen als persoonlijke
 * context; `dismissed` = geweigerd (komt niet terug). Gesloten lijst, op de API-grens gevalideerd.
 */
export const preferenceSuggestionStatusSchema = z.enum([
  'none',
  'pending',
  'accepted',
  'dismissed',
]);
export type PreferenceSuggestionStatus = z.infer<typeof preferenceSuggestionStatusSchema>;

/**
 * Publieke weergave van één geleerde voorkeur (`GET /users/{id}/preferences`). Bevat de canonieke
 * conceptsleutel plus het bijbehorende AAC-`label` (op de server opgezocht, terugval = het concept zelf),
 * de afgeleide `confidence` (0–1), hoe vaak het concept bevestigd is (`count`) en de suggestie-status.
 * `suggested` is een afgeleid gemak-veld voor de UI: `true` zodra er een openstaande suggestie is.
 */
export const preferencePublicSchema = z.object({
  id: z.string(),
  userId: z.string(),
  concept: z.string(),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  count: z.number().int().nonnegative(),
  suggestionStatus: preferenceSuggestionStatusSchema,
  suggested: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type PreferencePublic = z.infer<typeof preferencePublicSchema>;

/** Antwoord op `GET /users/{id}/preferences`: alle voorkeuren, aflopend op zekerheid/count. */
export const preferenceListResponseSchema = z.object({
  preferences: z.array(preferencePublicSchema),
});
export type PreferenceListResponse = z.infer<typeof preferenceListResponseSchema>;

/**
 * Afhandeling van een openstaande begeleider-suggestie (`POST /users/{id}/preferences/{prefId}/suggestion`,
 * DESIGN §3.8): `accept` neemt de voorkeur over als persoonlijke context (met een sensibele standaard),
 * `adjust` doet hetzelfde maar met een door de begeleider aangepaste categorie/naam, en `reject` weigert de
 * suggestie. Bij `adjust` zijn `category` en `name` verplicht; `accept`/`reject` negeren ze.
 */
export const preferenceSuggestionActionSchema = z
  .object({
    action: z.enum(['accept', 'adjust', 'reject']),
    category: personalContextCategorySchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.action !== 'adjust' || (v.category !== undefined && v.name !== undefined), {
    message: 'Bij aanpassen zijn categorie en naam verplicht.',
  });
export type PreferenceSuggestionAction = z.infer<typeof preferenceSuggestionActionSchema>;

// --- Profielexport/-import (T8.1, DESIGN §6.4, §8.2, FR-019) ---

/**
 * Huidige versie van het profielexportformaat. Reist mee in de payload zodat een importeur een ouder/
 * nieuwer formaat kan herkennen en weigeren i.p.v. verkeerd te interpreteren (ruimte voor migratie later).
 */
export const PROFILE_EXPORT_VERSION = 1;

/**
 * Eén stuk persoonlijke context binnen een profielexport (DESIGN §6.4). Bewust de **ontsleutelde** vorm:
 * de export-payload als geheel wordt versleuteld (het bestand is onleesbaar zonder sleutel), dus binnenin
 * staan `name`/`relationship` leesbaar zodat een import ze opnieuw kan versleutelen in de doelomgeving.
 * Geen id's of `userId`: die zijn omgeving-specifiek en horen niet in een draagbaar profiel.
 */
export const profileExportContextSchema = z.object({
  category: personalContextCategorySchema,
  name: z.string(),
  relationship: z.string().nullable(),
  aiUsageAllowed: z.boolean(),
});
export type ProfileExportContext = z.infer<typeof profileExportContextSchema>;

/**
 * Eén geleerde voorkeur binnen een profielexport (DESIGN §6.4). Alleen de canonieke conceptsleutel + de
 * afgeleide zekerheid/teller/herkomst — nooit communicatie-inhoud (privacy by design, §9.4). `suggestionStatus`
 * reist mee zodat een reeds afgehandelde begeleider-suggestie na import niet opnieuw opduikt.
 */
export const profileExportPreferenceSchema = z.object({
  concept: z.string(),
  confidence: z.number().min(0).max(1),
  count: z.number().int().nonnegative(),
  source: z.string(),
  suggestionStatus: preferenceSuggestionStatusSchema,
});
export type ProfileExportPreference = z.infer<typeof profileExportPreferenceSchema>;

/**
 * De **ontsleutelde** inhoud van een profielexport (DESIGN §6.4, FR-019). Bevat uitsluitend het
 * gebruikersprofiel: naam, communicatie-instellingen, persoonlijke context en geleerde voorkeuren.
 * Bewust **niet**: account- of organisatiegegevens, id's of tokens — het profiel is eigendom van de
 * gebruiker en draagbaar naar een andere omgeving. Deze payload wordt in zijn geheel versleuteld voordat
 * hij het bestand in gaat (`profileExportResponseSchema.data`).
 */
export const profileExportSchema = z.object({
  version: z.literal(PROFILE_EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  user: z.object({ name: z.string() }),
  /**
   * Het communicatieprofiel. De **gespreksstrategie** (T11.4) heeft hier bewust een terugval: een
   * bestand dat vóór die instelling is geëxporteerd bevat het veld niet, en dat is geen reden om een
   * overdracht te weigeren — die gebruiker had toen de standaardaanpak.
   */
  communicationProfile: communicationProfileSchema.extend({
    conversationStrategy: conversationStrategySchema.default(DEFAULT_CONVERSATION_STRATEGY),
  }),
  personalContexts: z.array(profileExportContextSchema),
  preferences: z.array(profileExportPreferenceSchema),
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

// --- Begeleiders koppelen (T2.2, DESIGN §2, FR-017) ---

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
   * De rol van het account (T9.1). Een **beheerder mag ook begeleider zijn**: een ADMIN kan aan een
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
 * ADMIN-account binnen dezelfde organisatie zijn (afgedwongen op de server, T9.1).
 */
export const linkCaregiverRequestSchema = z.object({
  accountId: z.string().min(1),
  linked: z.boolean(),
});
export type LinkCaregiverRequest = z.infer<typeof linkCaregiverRequestSchema>;

// --- Tabletkoppeling / apparaten (T2.3, DESIGN §6.2, §8.2, FR-018) ---

/**
 * Antwoord op `POST /admin/users/{id}/device-code`: de zojuist gegenereerde koppelcode en het
 * moment waarop die verloopt. De **plaintext** code wordt hier één keer teruggegeven zodat de
 * beheerder 'm op de tablet kan invoeren; daarna kent de server alleen nog de hash (de code is
 * niet opnieuw op te vragen). De code is eenmalig en verloopt (DESIGN §3.7 stap 5, FR-018).
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

// --- AAC-bibliotheek (T3.1, DESIGN §6.2, §8.2, FR-015) ---

/**
 * Categorie van een AAC-symbool. Bewust een gesloten lijst (DESIGN §3): de startscherm-intenties
 * (`intent`) plus de verfijningscategorieën. Gevalideerd op de API-grens; ook de bron voor de
 * db-validatie op de grens (geen native enum i.v.m. SQLite/PostgreSQL-portabiliteit).
 */
export const aacCategorySchema = z.enum([
  'intent', // startscherm-intenties (iets zeggen, willen, voelen, probleem, vraag)
  'activity', // activiteiten (wandelen, fietsen, …)
  'feeling', // gevoelens (blij, verdrietig, moe, …)
  'body', // lichaamsdelen (hoofd, buik, been, …)
  'food', // eten
  'drink', // drinken
  'person', // personen (mama, papa, …)
  'place', // plekken (thuis, park, toilet, …)
  'animal', // dieren (hond, …)
  'object', // voorwerpen
  'question', // vraagwoorden (wie, wat, waar, wanneer, mag ik) — T9.11
  'expression', // sociale uitingen (ja, nee, dank je, hallo, stop) — T9.11
]);
export type AacCategory = z.infer<typeof aacCategorySchema>;

/**
 * Bronvermelding en licentie van een pictogramafbeelding (T3.3). Wordt gevuld wanneer een
 * afbeelding uit een externe bron (OpenSymbols) is gekoppeld, zodat de licentie-attributie
 * altijd met het pictogram meereist (CC-attributie vereist auteur + bron + licentie). Bij een
 * zelf-geüploade afbeelding of de glyph-placeholder is dit `null`.
 */
export const aacAttributionSchema = z.object({
  /** Naam van de licentie, bv. "CC BY-SA". */
  license: z.string(),
  /** URL naar de licentietekst (indien bekend). */
  licenseUrl: z.string().nullable(),
  /** Auteur/maker van het pictogram (indien bekend). */
  author: z.string().nullable(),
  /** URL naar de auteur (indien bekend). */
  authorUrl: z.string().nullable(),
  /** Bron-URL van het pictogram bij de externe dienst (indien bekend). */
  sourceUrl: z.string().nullable(),
});
export type AacAttribution = z.infer<typeof aacAttributionSchema>;

/**
 * Publieke weergave van een AAC-symbool (zoekresultaat). `imageUrl` is het pad waarop het
 * pictogram bereikbaar is (`GET /aac/images/:id.svg`); de web-client toont dat rechtstreeks.
 * `attribution` draagt de bron/licentie van een gekoppelde externe afbeelding (T3.3), of `null`.
 * `searchText` en interne velden worden nooit meegestuurd.
 */
export const aacSymbolSchema = z.object({
  id: z.string(),
  concept: z.string(),
  label: z.string(),
  category: aacCategorySchema,
  glyph: z.string(),
  synonyms: z.array(z.string()),
  imageUrl: z.string(),
  attribution: aacAttributionSchema.nullable(),
  /**
   * Of dit een **nieuw woord** is dat de AI tijdens een gesprek aandroeg en dat nog niet door een
   * beheerder is bekeken (T10.6, DESIGN §7.6 trap 3). De gebruikersapp markeert zo'n pictogram
   * zichtbaar, zodat de gebruiker ziet dat dit geen vertrouwd bibliotheekwoord is maar een suggestie —
   * hij kiest het nog steeds zelf (DESIGN §7.8). `false` voor alles uit de beheerde bibliotheek.
   */
  isNew: z.boolean().default(false),
});
export type AacSymbol = z.infer<typeof aacSymbolSchema>;

/**
 * Zoekverzoek (`GET /aac/search?q=…`). De term wordt getrimd en naar lowercase genormaliseerd,
 * zodat de match hoofdletterongevoelig en portabel is (server matcht op een lowercase zoekindex).
 * Minimaal 1 teken; een lege query levert een 400 in plaats van de hele bibliotheek.
 */
export const aacSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .transform((value) => value.toLowerCase()),
});
export type AacSearchQuery = z.infer<typeof aacSearchQuerySchema>;

/** Antwoord op `GET /aac/search`: de gevonden symbolen (bibliotheek is niet tenant-gebonden). */
export const aacSearchResponseSchema = z.object({
  symbols: z.array(aacSymbolSchema),
});
export type AacSearchResponse = z.infer<typeof aacSearchResponseSchema>;

// --- AAC-beheer (T3.2, DESIGN §5.2, FR-015) ---

/**
 * Canonieke conceptsleutel bij aanmaken/bewerken: lowercase, alleen letters/cijfers/koppeltekens
 * (bv. "do-activity"). Bewust streng en taalneutraal — het concept is de stabiele sleutel waarnaar
 * relaties en straks de AI-context verwijzen, niet de (Nederlandse) weergavetekst. Wordt getrimd en
 * naar lowercase genormaliseerd zodat "Walking" en "walking" hetzelfde concept zijn.
 */
export const aacConceptKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((value) => value.toLowerCase())
  .refine((value) => /^[a-z0-9-]+$/.test(value), {
    message: 'Concept mag alleen kleine letters, cijfers en koppeltekens bevatten.',
  });

/**
 * Synoniemen bij aanmaken/bewerken: extra zoektermen. Elk synoniem wordt getrimd; lege waarden
 * vallen weg en dubbelen (case-insensitief) worden ontdubbeld, zodat de zoekindex schoon blijft.
 */
export const aacSynonymsSchema = z
  .array(z.string().trim().max(64))
  .max(25)
  .transform((values) => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  });

/**
 * Aanmaak-/bewerkverzoek voor een AAC-symbool (`POST`/`PUT /admin/aac/symbols`). Beheerderstaak
 * (DESIGN §2, §5.2). `glyph` blijft verplicht: het is de emoji-fallback waaruit de server een
 * placeholder-pictogram rendert zolang er geen afbeelding is geüpload. Een geüploade afbeelding
 * gaat via een apart endpoint (multipart), niet via deze JSON-body.
 */
export const aacSymbolInputSchema = z.object({
  concept: aacConceptKeySchema,
  label: z.string().trim().min(1).max(120),
  category: aacCategorySchema,
  glyph: z.string().trim().min(1).max(16),
  synonyms: aacSynonymsSchema,
});
export type AacSymbolInput = z.infer<typeof aacSymbolInputSchema>;

/**
 * Eén relatie in de beheerweergave van een symbool: de andere kant van een `AacConceptRelation`
 * plus het relatie-id (nodig om de relatie te kunnen verwijderen). Vanuit een symbool bekeken is
 * `symbol` óf het kind (bij uitgaande relaties) óf de ouder (bij inkomende).
 */
export const aacRelationEdgeSchema = z.object({
  relationId: z.string(),
  relation: z.string(),
  symbol: aacSymbolSchema,
});
export type AacRelationEdge = z.infer<typeof aacRelationEdgeSchema>;

/**
 * Beheerweergave van een AAC-symbool: de publieke velden plus of er een geüploade afbeelding is
 * (`hasImage`) en de gelegde relaties. `children` = relaties waarin dit symbool de ouder is
 * (bv. "buiten" → "wandelen"); `parents` = relaties waarin het het kind is. Zo kan de beheer-UI
 * de begrippenboom tonen en beheren.
 */
export const aacSymbolAdminSchema = aacSymbolSchema.extend({
  hasImage: z.boolean(),
  children: z.array(aacRelationEdgeSchema),
  parents: z.array(aacRelationEdgeSchema),
});
export type AacSymbolAdmin = z.infer<typeof aacSymbolAdminSchema>;

/** Antwoord op `GET /admin/aac/symbols`: alle symbolen met relaties (niet tenant-gebonden). */
export const aacSymbolListResponseSchema = z.object({
  symbols: z.array(aacSymbolAdminSchema),
});
export type AacSymbolListResponse = z.infer<typeof aacSymbolListResponseSchema>;

/**
 * Aanmaakverzoek voor een relatie (`POST /admin/aac/relations`). Legt een begripsrelatie
 * ouder → kind. `relation` typeert de relatie (standaard "contains"). Ouder en kind moeten
 * verschillen (afgedwongen op de server: geen zelfrelatie).
 */
export const aacRelationInputSchema = z.object({
  parentId: z.string().min(1),
  childId: z.string().min(1),
  relation: z.string().trim().min(1).max(32).default('contains'),
});
export type AacRelationInput = z.infer<typeof aacRelationInputSchema>;

// --- OpenSymbols-integratie (T3.3, DESIGN §6.2, §8.2, FR-015) ---

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
 * praat namens de client met OpenSymbols (de client nooit rechtstreeks, DESIGN §8.1). `locale`
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
 * Eén (reeds gesaneerd) OpenSymbols-zoekresultaat zoals de backend het aan de beheer-UI teruggeeft.
 * `imageUrl` is gegarandeerd een `https`-URL (anders is het resultaat door de proxy weggelaten).
 * De licentie-/bronvelden worden bij het koppelen op het `AacSymbol` vastgelegd (attributie).
 */
export const openSymbolsResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageUrl: httpsUrlSchema,
  extension: z.string(),
  license: z.string(),
  licenseUrl: z.string().nullable(),
  author: z.string().nullable(),
  authorUrl: z.string().nullable(),
  sourceUrl: z.string().nullable(),
});
export type OpenSymbolsResult = z.infer<typeof openSymbolsResultSchema>;

/** Antwoord op de OpenSymbols-zoekproxy: de gesaneerde resultaten (niet tenant-gebonden). */
export const openSymbolsSearchResponseSchema = z.object({
  results: z.array(openSymbolsResultSchema),
});
export type OpenSymbolsSearchResponse = z.infer<typeof openSymbolsSearchResponseSchema>;

/**
 * Koppelverzoek (`POST /admin/aac/symbols/:id/opensymbols`): een gekozen OpenSymbols-afbeelding aan
 * een bestaand symbool koppelen. De backend haalt de afbeelding zelf op (`https`-only, content-type
 * + groottelimiet gecontroleerd), slaat 'm lokaal op en legt de bron/licentie vast. De client stuurt
 * alléén de bron-URL en de attributie-metadata mee — de bytes worden server-side opgehaald, nooit
 * door de client aangeleverd.
 */
export const attachOpenSymbolsRequestSchema = z.object({
  imageUrl: httpsUrlSchema,
  license: z.string().trim().min(1).max(200),
  licenseUrl: httpsUrlSchema.nullable().optional(),
  author: z.string().trim().max(200).nullable().optional(),
  authorUrl: httpsUrlSchema.nullable().optional(),
  sourceUrl: httpsUrlSchema.nullable().optional(),
});
export type AttachOpenSymbolsRequest = z.infer<typeof attachOpenSymbolsRequestSchema>;

// --- Gespreksflow: sessies en stappen (T4.1, DESIGN §3.1, §6.2, §8.2, FR-001/005/006/010) ---

/**
 * Status van een gespreksessie (`ConversationSession.status`, DESIGN §6.2). In T4.1 wordt alleen
 * `ACTIVE` gebruikt; `COMPLETED` (bevestigde boodschap) en `ABANDONED` volgen in latere taken (T4.3).
 * Bewust een gesloten lijst, gevalideerd op de API-grens (geen native enum i.v.m. portabiliteit).
 */
export const conversationStatusSchema = z.enum(['ACTIVE', 'COMPLETED', 'ABANDONED']);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

/**
 * Een vraag in het gesprek: de prompttekst plus de aangeboden pictogramopties (AAC-symbolen). De
 * gescripte engine (T4.1) leidt dit af uit de AAC-relatieboom; de AI-orchestrator neemt die rol later
 * over achter dezelfde vorm. `options` is nooit leeg zolang er een vraag is (bij een eindconcept is er
 * geen vraag meer en geldt `done: true`).
 */
export const conversationQuestionSchema = z.object({
  prompt: z.string(),
  options: z.array(aacSymbolSchema),
});
export type ConversationQuestion = z.infer<typeof conversationQuestionSchema>;

/**
 * Eén afgelegde stap in de historie: de getoonde vraag en het gekozen symbool. Zo kan de UI de
 * gekozen route (broodkruimel) tonen en herstelt de terug-functie de exacte vorige context.
 */
export const conversationStepSchema = z.object({
  order: z.number().int().nonnegative(),
  question: z.string(),
  symbol: aacSymbolSchema,
});
export type ConversationStep = z.infer<typeof conversationStepSchema>;

/**
 * Keuzeverzoek voor `POST /conversation/{id}/next` en `.../choice`: het gekozen symbool-id. Het
 * moet één van de op dat moment aangeboden opties zijn (anders `400 INVALID_CHOICE`), zodat een
 * gesprek nooit buiten de aangeboden AAC-route kan springen.
 */
export const conversationChoiceRequestSchema = z.object({
  symbolId: z.string().min(1),
});
export type ConversationChoiceRequest = z.infer<typeof conversationChoiceRequestSchema>;

/**
 * Fase van de gespreksbeslissing (T5.2, DESIGN §7.4), afgeleid uit de interpretatie-zekerheid van de
 * AI: `select` (<60% — nieuwe pictogramvraag), `refine` (60–85% — verder verfijnen), `propose` (>85%
 * of een eindconcept — boodschap voorstellen). De UI kan hiermee de juiste toon aanslaan; `propose`
 * valt samen met `done: true`.
 */
export const conversationPhaseSchema = z.enum(['select', 'refine', 'propose']);
export type ConversationPhase = z.infer<typeof conversationPhaseSchema>;

/**
 * Gesprekstoestand na `start`, `next` of `back`: de sessie, de huidige vraag (of `null` als de route
 * een eindconcept bereikte en `done: true`), en de tot nu toe afgelegde stappen. De tablet-UI (T4.2)
 * rendert hieruit het keuzescherm; `done` markeert dat er een boodschap voorgesteld kan worden (T4.3).
 *
 * Vanaf T5.2 wordt de vraag door de AI-orchestrator gekozen (mock in tests) i.p.v. de gescripte engine.
 * `confidence` (de interpretatie-zekerheid, DESIGN §7.4) en `phase` (de afgeleide band) zijn optioneel
 * meegegeven zodat de UI/latere taken de zekerheid kunnen tonen; ze ontbreken alleen wanneer er geen
 * vraag meer is en er geen zekerheid te melden valt.
 */
export const conversationStateResponseSchema = z.object({
  sessionId: z.string(),
  status: conversationStatusSchema,
  question: conversationQuestionSchema.nullable(),
  done: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  phase: conversationPhaseSchema.optional(),
  history: z.array(conversationStepSchema),
  /**
   * De letterlijke begeleidersvraag bij een **vraagmodus**-sessie (T7.1, DESIGN §3.2): de gebruikersapp
   * toont die als context boven het keuzescherm ("Je begeleider vraagt: …") terwijl de gebruiker het
   * antwoord samenstelt. `null`/afwezig bij een vrij gesprek — dan verschijnt geen vraagbanner.
   */
  caregiverQuestion: z.string().nullable().optional(),
  /**
   * Of de gebruiker het gesprek **hier** mag afronden (T10.11, DESIGN §3.1): dan verschijnt naast
   * "↩ Terug" de knop "✅ Dit is genoeg", die naar het voorstelscherm gaat met de route zoals hij is.
   *
   * Nodig sinds T10.10, dat pas een boodschap voorstelt als er niets meer te verfijnen valt. Dat lost
   * het vage "Ik wil iets warms eten." op, maar maakt een categorie als eindpunt onbereikbaar — terwijl
   * "Ik wil eten." in AAC een volwaardige boodschap is. De server bepaalt dit, niet de tablet: alleen hij
   * weet of de gebruiker zélf al iets koos (in vraagmodus telt het anker van de begeleider niet mee,
   * §2/T9.14). `false` zolang er niets van de gebruiker is om voor te stellen.
   */
  canFinish: z.boolean().default(false),
});
export type ConversationStateResponse = z.infer<typeof conversationStateResponseSchema>;

/**
 * Antwoord op `POST /conversation/{id}/choice`: de zojuist opgeslagen stap plus of er nog verfijning
 * mogelijk is (`canRefine`). Bewust smaller dan de volledige toestand: `/choice` **slaat alleen op**
 * (DESIGN §8.2 "keuze opslaan"), terwijl `/next` de keuze opslaat én de volgende vraag teruggeeft.
 * Een normale gespreksbeurt gebruikt `/next`; `/choice` is de save-only primitive (o.a. voor het
 * expliciet vastleggen van een eindkeuze en latere ondersteuningsmodus).
 */
export const conversationChoiceResponseSchema = z.object({
  sessionId: z.string(),
  status: conversationStatusSchema,
  step: conversationStepSchema,
  canRefine: z.boolean(),
  history: z.array(conversationStepSchema),
});
export type ConversationChoiceResponse = z.infer<typeof conversationChoiceResponseSchema>;

/**
 * Soort correctie op een voorstel (`CorrectionEvent.type`, DESIGN §3.4, §6.2). In de MVP alleen
 * `wrong_guess`: de gebruiker koos ❌ ("Nee, dit klopt niet"). Bewust een gesloten lijst zodat latere
 * correctietypes expliciet worden toegevoegd.
 */
export const conversationCorrectionTypeSchema = z.enum(['wrong_guess', 'no_fitting_option']);
export type ConversationCorrectionType = z.infer<typeof conversationCorrectionTypeSchema>;

/**
 * Verzoek voor `POST /conversation/{id}/correction` (T5.4/T9.12, DESIGN §3.4, §8.2, FR-009). Twee
 * soorten "dit klopt niet", met elk een eigen herstel:
 *
 * - `wrong_guess` (standaard, zodat een lege body `{}` volstaat) — de gebruiker wijst het **voorstel**
 *   af (❌ Nee). De server heranalyseert de route, rolt de vermoedelijke foutstap terug en geeft een
 *   gerichtere hervraag terug — **niet** terug naar het begin.
 * - `no_fitting_option` (T9.12) — het juiste pictogram staat **niet bij de aangeboden opties**. Alle
 *   concepten van dit punt worden voor de rest van de sessie uitgesloten, waarna het gesprek een niveau
 *   hoger verdergaat met andere opties. De reeds gemaakte keuzes blijven staan.
 *
 * Het antwoord is in beide gevallen een gewone `ConversationStateResponse` (hetzelfde keuzescherm).
 */
export const conversationCorrectionRequestSchema = z.object({
  type: conversationCorrectionTypeSchema.default('wrong_guess'),
});
export type ConversationCorrectionRequest = z.infer<typeof conversationCorrectionRequestSchema>;

// --- Boodschap voorstellen en bevestigen (T4.3, DESIGN §3.1, §3.6, §6.2, §8.2, FR-007) ---

/**
 * Antwoord op `POST /conversation/{id}/generate` (DESIGN §8.2): een **voorstel** voor de boodschap,
 * gevormd uit de tot nu toe gekozen concepten. In deze fase sjabloon-gebaseerd; de AI-orchestrator
 * neemt het genereren later over achter dezelfde vorm (T5.3). Bevat de geformuleerde `message`, de
 * `confidence` (DESIGN §7.4; in de gescripte engine deterministisch) en de `symbols` (de pictogramreeks
 * van de gekozen route) zodat het voorstelscherm de reeks + zin kan tonen. Bewust **vluchtig**: het
 * genereren slaat niets op — pas bij `confirm` wordt de boodschap bewaard (DESIGN §3.6, geen afgewezen
 * voorstellen in de db).
 */
export const conversationGenerateResponseSchema = z.object({
  sessionId: z.string(),
  status: conversationStatusSchema,
  message: z.string(),
  confidence: z.number().min(0).max(1),
  symbols: z.array(aacSymbolSchema),
  history: z.array(conversationStepSchema),
});
export type ConversationGenerateResponse = z.infer<typeof conversationGenerateResponseSchema>;

/**
 * Antwoord op `POST /conversation/{id}/confirm` (DESIGN §8.2): de sessie is afgerond (`status`
 * `COMPLETED`) en de bevestigde `message` is opgeslagen (`GeneratedMessage`, DESIGN §6.2). De server
 * hergenereert de boodschap deterministisch uit de opgeslagen keuzes, zodat de bevaarde zin altijd
 * binnen de gekozen concepten blijft (de client levert geen vrije tekst aan). Een afwijzing verloopt
 * niet via dit endpoint maar via `/back` (terug naar de laatste vraag) — er wordt dan niets opgeslagen.
 */
export const conversationConfirmResponseSchema = z.object({
  sessionId: z.string(),
  status: conversationStatusSchema,
  message: z.string(),
});
export type ConversationConfirmResponse = z.infer<typeof conversationConfirmResponseSchema>;

// --- Vraagmodus: begeleider stelt een vraag (T7.1, DESIGN §3.2, §8.2, FR-012) ---

/**
 * Verzoek van een begeleider om via de **vraagmodus** een gesprek te starten (`POST /question/start`,
 * DESIGN §3.2). De begeleider typt de vraag (`question`) en kiest een **AAC-topic** (`anchorConcept`,
 * de canonieke conceptsleutel, bv. "drink") waarvan de kinderen de mogelijke antwoorden vormen
 * (🥤 water · 🧃 sap · ☕ koffie · 🥛 melk). Zo begrenst de bibliotheek de antwoorden (DESIGN §7.6) en
 * blijft alles deterministisch en testbaar. `userId` is de gebruiker aan wie de vraag gesteld wordt;
 * de server bewaakt tenant-isolatie én de begeleider-koppeling (alleen gekoppelde gebruikers).
 */
export const questionStartRequestSchema = z.object({
  userId: z.string().min(1),
  question: z.string().trim().min(1).max(300),
  anchorConcept: aacConceptKeySchema,
  /**
   * Optionele **gespreksstrategie** voor dít gesprek (T11.5, DESIGN §7.10). Eén persoon kan per
   * situatie een andere aanpak nodig hebben: een vraag over pijn vraagt om een andere benadering dan
   * "wat wil je doen vanmiddag". Weggelaten = de instelling van de gebruiker (§5.3). Een onbekende
   * sleutel wordt geweigerd (400) — nooit een half toegepaste strategie.
   */
  strategy: conversationStrategySchema.optional(),
});
export type QuestionStartRequest = z.infer<typeof questionStartRequestSchema>;

/**
 * Antwoord op `POST /question/start`: bevestiging dat de vraag klaarstaat in de gebruikersapp. Bewust
 * smal — de vraag "verschijnt in de gebruikersapp" (tablet, device-auth), niet op het scherm van de
 * begeleider. De begeleider ziet alleen dat de vraag is verstuurd.
 */
export const questionStartResponseSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  question: z.string(),
});
export type QuestionStartResponse = z.infer<typeof questionStartResponseSchema>;

/**
 * Antwoord op `GET /conversation/pending` (tablet, device-auth): de openstaande vraagmodus-sessie voor
 * de eigen gebruiker als volledige gesprekstoestand, of `null` als er geen begeleidersvraag klaarstaat.
 * De tablet gebruikt dit om bij het openen (of na "opnieuw beginnen") eerst een begeleidersvraag op te
 * pakken; is er geen, dan start hij een vrij gesprek.
 */
export const pendingQuestionResponseSchema = z.object({
  state: conversationStateResponseSchema.nullable(),
});
export type PendingQuestionResponse = z.infer<typeof pendingQuestionResponseSchema>;

// --- Ondersteuningsmodus en begeleiderweergave (T7.2, DESIGN §3.3, §5.2, FR-011) ---

/**
 * Read-only **meekijkweergave** voor een begeleider/beheerder (`GET /question/users/:id/conversation`,
 * T7.2, DESIGN §3.3, §5.2). De begeleider ziet de gesprekcontext van een gekoppelde gebruiker — het
 * afgelegde pad (`history`, de broodkruimel), een eventuele eigen vraag (`caregiverQuestion`) en of de
 * gebruiker in **ondersteuningsmodus** staat (`supportMode`, DESIGN §3.3) — zónder zelf iets te kunnen
 * kiezen of bevestigen: bevestigen kan uitsluitend de gebruiker op de tablet (server-side afgedwongen).
 *
 * Bewust een snapshot uit de **opgeslagen** stappen (geen AI-aanroep bij het meekijken): `session` is
 * `null` als er geen actief gesprek loopt. `mode` is `"free"` of `"question"` (vraagmodus).
 */
export const caregiverConversationViewSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  /** Staat de gebruiker in ondersteuningsmodus? De begeleider tikt dan aan namens de gebruiker (§3.3). */
  supportMode: z.boolean(),
  session: z
    .object({
      sessionId: z.string(),
      status: conversationStatusSchema,
      mode: z.string(),
      caregiverQuestion: z.string().nullable(),
      history: z.array(conversationStepSchema),
      /**
       * De **actieve gespreksstrategie** van dit gesprek (T11.6, DESIGN §7.10): sleutel en label, zodat
       * de meekijkende begeleider ziet wélke aanpak loopt. Bewust niet méér — geen promptinhoud, geen
       * parameters en geen persoonlijke context (DESIGN §9.4).
       */
      strategy: z.object({ key: conversationStrategySchema, label: z.string() }),
    })
    .nullable(),
});
export type CaregiverConversationView = z.infer<typeof caregiverConversationViewSchema>;

// --- Worker-token-beheer (T5.8, DESIGN §5.2, §9.4, ADR-0010) ---

/**
 * Toegestane scopes voor een worker-token. In de MVP alleen `ai:process` (een worker mag AI-jobs
 * verwerken). Bewust een gesloten lijst, gevalideerd op de API-grens — een onbekende scope wordt
 * geweigerd (400) i.p.v. stil een te ruim recht te verlenen.
 */
export const workerScopeSchema = z.enum(['ai:process']);
export type WorkerScope = z.infer<typeof workerScopeSchema>;

/**
 * Status van een worker-token in de beheerweergave, afgeleid van `revokedAt`/`expiresAt`:
 * `active` (bruikbaar), `revoked` (ingetrokken) of `expired` (vervaltijd verstreken). Zo kan de
 * beheer-UI in één oogopslag tonen of een token nog werkt zonder zelf datums te vergelijken.
 */
export const workerTokenStatusSchema = z.enum(['active', 'revoked', 'expired']);
export type WorkerTokenStatus = z.infer<typeof workerTokenStatusSchema>;

/**
 * Publieke weergave van een worker-token (`GET /admin/worker-tokens`). Bevat **nooit** het rauwe
 * token of de hash — alleen beheer-/diagnosevelden. Het rauwe token verlaat de server uitsluitend
 * één keer bij aanmaken (zie `createWorkerTokenResponseSchema`).
 */
export const workerTokenPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  status: workerTokenStatusSchema,
  /** Laatst geziene activiteit (best-effort bij claim/heartbeat bijgewerkt), of `null`. */
  lastSeenAt: z.iso.datetime().nullable(),
  /** Vervaltijd of `null` (verloopt niet). */
  expiresAt: z.iso.datetime().nullable(),
  /** Moment van intrekken of `null` (niet ingetrokken). */
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type WorkerTokenPublic = z.infer<typeof workerTokenPublicSchema>;

/** Antwoord op `GET /admin/worker-tokens`: alle worker-tokens (platform-infrastructuur, niet tenant-gebonden). */
export const workerTokenListResponseSchema = z.object({
  tokens: z.array(workerTokenPublicSchema),
});
export type WorkerTokenListResponse = z.infer<typeof workerTokenListResponseSchema>;

/**
 * Aanmaakverzoek (`POST /admin/worker-tokens`). `name` is een menselijke labelnaam (bv. "gpu-node-1").
 * `scopes` optioneel (standaard alléén `ai:process`); `ttlDays` optioneel — weggelaten = het token
 * verloopt niet. Alles wordt op de server opnieuw gevalideerd — dit schema is de gedeelde bron.
 */
export const createWorkerTokenRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(workerScopeSchema).min(1).max(8).optional(),
  ttlDays: z.number().int().positive().max(3650).optional(),
});
export type CreateWorkerTokenRequest = z.infer<typeof createWorkerTokenRequestSchema>;

/**
 * Antwoord op `POST /admin/worker-tokens`: het aangemaakte token plus het **rauwe** token. Dit is de
 * enige plek waar het rauwe token de server verlaat — de beheer-UI toont het één keer en daarna kent
 * de server alleen nog de SHA-256-hash. Zet het als `WORKER_TOKEN` in de `.env` van de worker (T5.6).
 */
export const createWorkerTokenResponseSchema = z.object({
  workerToken: workerTokenPublicSchema,
  token: z.string(),
});
export type CreateWorkerTokenResponse = z.infer<typeof createWorkerTokenResponseSchema>;

// --- Beheerdashboard (T7.3, DESIGN §5.2, FR-016) ---

/**
 * Eén regel "recente activiteit" op het beheerdashboard: een gespreksessie van een gebruiker in de
 * eigen organisatie. Bewust **zonder communicatie-inhoud** (privacy by design, DESIGN §6.4, §9.4) —
 * alleen wie/wanneer/status en het aantal bevestigde boodschappen, nooit de zinnen zelf.
 */
export const dashboardRecentSessionSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  userName: z.string(),
  status: conversationStatusSchema,
  /** "free" (gebruiker startte zelf) of "question" (begeleidersvraag). */
  mode: z.string(),
  /** Aantal bevestigde boodschappen in deze sessie (geen inhoud, alleen de telling). */
  messageCount: z.number().int().nonnegative(),
  startedAt: z.iso.datetime(),
});
export type DashboardRecentSession = z.infer<typeof dashboardRecentSessionSchema>;

/**
 * Antwoord op `GET /admin/dashboard` (T7.3): een beknopt overzicht van de **eigen organisatie**
 * (gebruikers, begeleiders, recente activiteit) plus het aantal openstaande AI-conceptvoorstellen.
 * De tellingen zijn tenant-gefilterd (`organizationId`); alleen `pendingProposals` is platformbreed
 * — de AAC-bibliotheek en haar voorstellen zijn gedeeld (net als het AAC-beheer, DESIGN §5.2).
 */
export const dashboardResponseSchema = z.object({
  users: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
  }),
  caregivers: z.object({
    total: z.number().int().nonnegative(),
  }),
  /** Openstaande (PENDING) AI-conceptvoorstellen; platformbreed, ter beoordeling door een beheerder. */
  pendingProposals: z.number().int().nonnegative(),
  recentActivity: z.array(dashboardRecentSessionSchema),
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

// --- AI-conceptvoorstellen (T5.2/T7.3, DESIGN §6.2, §7.6, FR-016) ---

/**
 * Status van een AI-conceptvoorstel: `PENDING` (nieuw, wacht op beoordeling), `APPROVED`
 * (goedgekeurd en aan een pictogram gekoppeld — pas dan mag de AI het gebruiken) of `REJECTED`
 * (afgewezen; het begrip blijft buiten de AAC-begrenzing). Op de API-grens gevalideerd.
 */
export const conceptProposalStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type ConceptProposalStatus = z.infer<typeof conceptProposalStatusSchema>;

/**
 * Publieke weergave van een AI-conceptvoorstel (`GET /admin/concept-proposals`). Door de
 * validatielaag (T5.2) aangemaakt wanneer de AI een begrip aandroeg dat niet in de bibliotheek
 * bestaat: de optie bereikte de gebruiker **nooit** en het begrip belandt hier ter beoordeling
 * (FR-016). `linkedSymbol` is het pictogram waaraan het na goedkeuring is gekoppeld, of `null`.
 */
export const conceptProposalSchema = z.object({
  id: z.string(),
  concept: z.string(),
  reason: z.string(),
  status: conceptProposalStatusSchema,
  linkedSymbol: aacSymbolSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ConceptProposal = z.infer<typeof conceptProposalSchema>;

/** Antwoord op `GET /admin/concept-proposals`: alle voorstellen (openstaande eerst). */
export const conceptProposalListResponseSchema = z.object({
  proposals: z.array(conceptProposalSchema),
});
export type ConceptProposalListResponse = z.infer<typeof conceptProposalListResponseSchema>;

/**
 * Goedkeuringsverzoek (`POST /admin/concept-proposals/:id/approve`): het bestaande AAC-pictogram
 * waaraan het voorgestelde begrip gekoppeld wordt. Na goedkeuring wordt het concept als synoniem
 * aan dat pictogram toegevoegd, zodat de AI het voortaan (via de validatielaag) mag aanbieden.
 */
export const approveConceptProposalRequestSchema = z.object({
  symbolId: z.string().min(1),
});
export type ApproveConceptProposalRequest = z.infer<typeof approveConceptProposalRequestSchema>;

// --- Door de AI aangedragen concepten beoordelen (T10.7, DESIGN §7.6 trap 4, ADR-0012) ---

/**
 * Eén door de AI tijdens een gesprek aangemaakt symbool, zoals de beheerder het te zien krijgt
 * (`GET /admin/aac/new-concepts`). Naast het pictogram zelf telt vooral hoe vaak het al gekozen is:
 * een begrip dat mensen echt gebruiken verdient een goed pictogram, een eenmalige uitschieter niet.
 */
export const aiConceptReviewSchema = z.object({
  symbol: aacSymbolAdminSchema,
  /** Hoe vaak dit concept in bevestigde én lopende gesprekken is gekozen. */
  timesChosen: z.number().int().min(0),
  /** De onderbouwing van de AI bij het aandragen (uit het `ConceptProposal`), of `null`. */
  reason: z.string().nullable(),
  /** Wanneer het concept is aangemaakt. */
  createdAt: z.iso.datetime(),
});
export type AiConceptReview = z.infer<typeof aiConceptReviewSchema>;

/** Antwoord op `GET /admin/aac/new-concepts`: de nog niet beoordeelde AI-concepten, nieuwste eerst. */
export const aiConceptReviewListResponseSchema = z.object({
  concepts: z.array(aiConceptReviewSchema),
});
export type AiConceptReviewListResponse = z.infer<typeof aiConceptReviewListResponseSchema>;

/**
 * Samenvoegverzoek (`POST /admin/aac/new-concepts/:id/merge`): het bestaande pictogram waarin dit
 * AI-concept opgaat. Het begrip wordt een **synoniem** van dat pictogram en verdwijnt als los concept,
 * zodat de bibliotheek niet volloopt met bijna-duplicaten (DESIGN §7.6).
 */
export const mergeAiConceptRequestSchema = z.object({
  targetSymbolId: z.string().min(1),
});
export type MergeAiConceptRequest = z.infer<typeof mergeAiConceptRequestSchema>;

// --- Audit-log (T8.2, DESIGN §9.4) ---

/** Uitkomst van een geauditeerde actie: geslaagd of mislukt (bv. een mislukte login). */
export const auditOutcomeSchema = z.enum(['success', 'failure']);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

/**
 * Publieke weergave van één audit-regel (`GET /admin/audit-logs`, T8.2, DESIGN §9.4). Een append-only
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

// --- Platform-operatorconsole (T8.3, DESIGN §9.1, §9.4, §10.4) ---

/**
 * Publieke weergave van één organisatie in de **operatorconsole** (`GET /operator/organizations`).
 *
 * Dit is de enige plek in Intento waar data van meerdere tenants naast elkaar staat, dus de vorm is
 * bewust smal: alleen **beheermetadata** (naam, soort, status, omvang). Geen communicatie-inhoud,
 * geen persoonlijke context, geen gebruikersnamen — die blijven binnen de tenant (DESIGN §9.4).
 * `userCount`/`accountCount` zijn aggregaten: een operator kan de omvang van een omgeving inschatten
 * (misbruik, capaciteit) zonder de mensen erin te zien.
 */
export const operatorOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: organizationTypeSchema,
  /** Actief; `false` = door een operator gedeactiveerd (login/sessies/tablets geweigerd). */
  active: z.boolean(),
  /** Platformorganisatie: hier wonen de operators en het worker-tokenbeheer (T5.8). */
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
 * eerste admin-account: een omgeving krijgt haar beheerder via zelfaanmelding (T1.3) of via de
 * ADMIN-flow binnen de tenant (T2.4). De operator zet dus de omgeving neer, maar mint geen
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
 * beschermde entiteit in Intento (DESIGN §2, §9.4) en een operator hoeft voor beheer alleen te weten
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

// --- AAC-onderwerpen voor de vraagmodus (T9.7, DESIGN §3.2, §7.6) ---

/**
 * Antwoord op `GET /aac/topics`: de symbolen die **antwoordopties hebben** (minstens één kind in de
 * relatieboom) en dus als onderwerp van een begeleidersvraag kunnen dienen (T7.1). De begeleider koos
 * dat onderwerp voorheen alleen via een zoekveld, waardoor de verstuurknop grijs bleef zonder uitleg
 * (T9.7); met deze lijst is het gewoon te kiezen.
 */
export const aacTopicListResponseSchema = z.object({
  topics: z.array(aacSymbolSchema),
});
export type AacTopicListResponse = z.infer<typeof aacTopicListResponseSchema>;

// --- AI-activiteit: wat doet de AI eigenlijk? (T9.15, DESIGN §7.2, §7.4, §9.4) ---

/** Status van een AI-job in de wachtrij (T5.5); vorm van `AiJob.status`, op de grens gevalideerd. */
export const aiJobStatusSchema = z.enum([
  'WAITING_FOR_WORKER',
  'QUEUED',
  'CLAIMED',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
]);
export type AiJobStatus = z.infer<typeof aiJobStatusSchema>;

/**
 * Eén regel in het AI-activiteitenoverzicht (T9.15): wat de AI gevraagd is, wat eruit kwam en hoe lang
 * het duurde. Bewust een **samenvatting van het resultaat**, nooit de prompt: in de prompt zit
 * persoonlijke context (T6.1) en die hoort niet in een beheerscherm (DESIGN §9.4).
 */
export const aiJobSummarySchema = z.object({
  id: z.string(),
  /** De AI-taak: volgende vraag kiezen of een boodschap formuleren. */
  task: z.string(),
  status: aiJobStatusSchema,
  /** Aantal keren dat de job geclaimd is (een teruggelegde job telt door). */
  attempts: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  /** Doorlooptijd tot de laatste statuswijziging, in ms. */
  durationMs: z.number().int().min(0),
  /** Naam van het worker-token dat de job (als laatste) oppakte; `null` als hij nog niet geclaimd is. */
  worker: z.string().nullable(),
  /** Korte foutmelding bij een mislukte job; `null` als er geen fout was. */
  error: z.string().nullable(),
  /** De vraag die de AI formuleerde (alleen bij een geslaagde vraagselectie). */
  question: z.string().nullable(),
  /** De door de AI aangedragen concepten met hun zekerheid, in de volgorde die de AI koos. */
  options: z.array(z.object({ concept: z.string(), confidence: z.number().nullable() })),
  /** De motivering die de AI meegaf (`reason`), of `null`. */
  reason: z.string().nullable(),
  /** De interpretatie-zekerheid uit het resultaat, of `null`. */
  confidence: z.number().nullable(),
  /**
   * De **gespreksstrategie** die deze aanvraag voortbracht (T11.6, DESIGN §7.10): alleen de sleutel.
   * Met meerdere aanpakken is "waarom deed de AI dit?" niet te beantwoorden zonder te weten wélke
   * draaide. `null` bij een boodschap-job of een oudere rij.
   */
  strategy: z.string().nullable(),
});
export type AiJobSummary = z.infer<typeof aiJobSummarySchema>;

/** Antwoord op `GET /admin/ai/jobs`: de recentste AI-jobs, nieuwste eerst (T9.15). */
export const aiJobListResponseSchema = z.object({
  jobs: z.array(aiJobSummarySchema),
});
export type AiJobListResponse = z.infer<typeof aiJobListResponseSchema>;

// --- AI-status (T9.4, DESIGN §7.2, §9.2, §9.4, ADR-0010) ---

/**
 * De draaiende AI-modus van de backend. `mock` is de deterministische mock-provider (géén echte AI:
 * hij kiest simpelweg de bibliotheekvolgorde), `queue` zet elke aanvraag op de wachtrij voor externe
 * workers (T5.5/T5.6). De waarde komt rechtstreeks uit `AI_PROVIDER`.
 */
export const aiModeSchema = z.enum(['mock', 'queue', 'ollama']);
export type AiMode = z.infer<typeof aiModeSchema>;

/**
 * Antwoord op `GET /ai/status` (T9.4): kan de gebruiker/begeleider zien dát er een AI meedenkt?
 *
 * In de gebruikerstest bleek dit niet zichtbaar: de backend draaide op `AI_PROVIDER=mock` en het leek
 * of de AI niets deed. Bewust **alleen infrastructuurmetadata** — nooit communicatie-inhoud, prompts
 * of persoonlijke context: de tablet toont er hooguit een klein statuslampje mee.
 */
export const aiStatusResponseSchema = z.object({
  /** De ingestelde modus (`AI_PROVIDER`). */
  mode: aiModeSchema,
  /** Of deze modus een externe worker nodig heeft (alleen `queue`). */
  workerRequired: z.boolean(),
  /** Aantal worker-tokens dat recent activiteit toonde (claim/heartbeat binnen het tijdvenster). */
  workersOnline: z.number().int().min(0),
  /** Laatste worker-activiteit, of `null` als er nog nooit een worker langskwam. */
  lastSeenAt: z.iso.datetime().nullable(),
  /**
   * Denkt er nu echt een AI mee? Waar bij `queue` met minstens één recent geziene worker; onwaar bij
   * `mock` (deterministische terugval) en bij `queue` zonder actieve worker.
   */
  active: z.boolean(),
});
export type AiStatusResponse = z.infer<typeof aiStatusResponseSchema>;
