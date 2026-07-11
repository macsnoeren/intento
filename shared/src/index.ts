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
   * Of het e-mailadres is geverifieerd (T1.4). Onbevestigde accounts mogen inloggen, maar
   * bepaalde gevoelige acties zijn geblokkeerd tot verificatie; de web-UI toont hierop een
   * herinnerings-banner met een "opnieuw versturen"-knop.
   */
  emailVerified: z.boolean(),
});
export type AccountPublic = z.infer<typeof accountPublicSchema>;

/** Antwoord van `POST /auth/login` en `GET /auth/me`. */
export const authResponseSchema = z.object({
  account: accountPublicSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

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
});
export type CaregiverLink = z.infer<typeof caregiverLinkSchema>;

/**
 * Antwoord op `GET /admin/users/{id}/caregivers`: alle CAREGIVER-accounts van de eigen
 * organisatie met per account of het aan deze gebruiker gekoppeld is (tenant-gefilterd).
 */
export const caregiverListResponseSchema = z.object({
  caregivers: z.array(caregiverLinkSchema),
});
export type CaregiverListResponse = z.infer<typeof caregiverListResponseSchema>;

/**
 * Koppelverzoek (`POST /admin/users/{id}/caregivers`). Eén endpoint voor koppelen én
 * ontkoppelen: `linked: true` legt de koppeling, `linked: false` verwijdert die. Idempotent —
 * herhaald koppelen/ontkoppelen levert dezelfde eindtoestand. `accountId` moet een
 * CAREGIVER-account binnen dezelfde organisatie zijn (afgedwongen op de server).
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
export const conversationCorrectionTypeSchema = z.enum(['wrong_guess']);
export type ConversationCorrectionType = z.infer<typeof conversationCorrectionTypeSchema>;

/**
 * Verzoek voor `POST /conversation/{id}/correction` (T5.4, DESIGN §3.4, §8.2, FR-009): de gebruiker
 * wijst het voorstel af. `type` staat standaard op `wrong_guess` (de enige waarde in de MVP), zodat een
 * lege body `{}` volstaat. De server heranalyseert dan de route, rolt de vermoedelijke foutstap terug
 * en geeft een gerichtere hervraag terug — **niet** terug naar het begin. Het antwoord is een gewone
 * `ConversationStateResponse` (het correctiescherm rendert dezelfde vorm als het keuzescherm).
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
