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
});
export type AccountPublic = z.infer<typeof accountPublicSchema>;

/** Antwoord van `POST /auth/login` en `GET /auth/me`. */
export const authResponseSchema = z.object({
  account: accountPublicSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

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
 * Publieke weergave van een AAC-symbool (zoekresultaat). `imageUrl` is het pad waarop het
 * pictogram bereikbaar is (`GET /aac/images/:id.svg`); de web-client toont dat rechtstreeks.
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
