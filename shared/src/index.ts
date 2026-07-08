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
