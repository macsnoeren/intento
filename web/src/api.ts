import {
  accountListResponseSchema,
  apiErrorSchema,
  auditLogListResponseSchema,
  authResponseSchema,
  changePasswordResponseSchema,
  caregiverListResponseSchema,
  dashboardResponseSchema,
  profileExportResponseSchema,
  createCaregiverResponseSchema,
  deviceCodeResponseSchema,
  deviceSessionResponseSchema,
  operatorOrganizationDetailSchema,
  operatorOrganizationListResponseSchema,
  operatorOrganizationSchema,
  resendVerificationResponseSchema,
  resetAccountPasswordResponseSchema,
  userListResponseSchema,
  userPublicSchema,
  verifyEmailResponseSchema,
  type AccountListResponse,
  type AuditLogListResponse,
  type AttributionListResponse,
  attributionListResponseSchema,
  type VocabularyItemPublic,
  type VocabularyListQuery,
  type VocabularyUpdateRequest,
  vocabularyItemPublicSchema,
  type VocabularyListResponse,
  vocabularyListResponseSchema,
  type AuthResponse,
  type ChangePasswordRequest,
  type ChangePasswordResponse,
  type CreateCaregiverRequest,
  type CreateCaregiverResponse,
  type CaregiverListResponse,
  type DashboardResponse,
  type CreateUserRequest,
  type DeviceCodeResponse,
  type DeviceSessionResponse,
  type CreateOperatorOrganizationRequest,
  type OperatorOrganization,
  type OperatorOrganizationDetail,
  type OperatorOrganizationListResponse,
  type ProfileExportResponse,
  type ProfileImportRequest,
  type RegisterRequest,
  type ResendVerificationResponse,
  type ResetAccountPasswordResponse,
  type UpdateSettingsRequest,
  type UserListResponse,
  type UserPublic,
  type VerifyEmailResponse,
} from '@intento/shared';

/**
 * API-client voor de web-app.
 *
 * De client praat via de backend (INTENTO-NEW-DESIGN §51, nooit rechtstreeks met de AI of db). Alle
 * requests sturen de sessie-cookie mee (`credentials: 'include'`) en alle responses worden
 * met de gedeelde zod-schema's gevalideerd, zodat client en server nooit uit elkaar lopen.
 *
 * De `Api`-interface maakt de datalaag injecteerbaar: componenten krijgen 'm als prop, zodat
 * tests een in-memory implementatie kunnen meegeven zonder echte netwerkcalls.
 */

/** Foutstructuur van de backend (INTENTO-NEW-DESIGN §51), als gooibare Error met code + HTTP-status. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface Api {
  me(): Promise<AuthResponse>;
  login(email: string, password: string): Promise<AuthResponse>;
  register(body: RegisterRequest): Promise<AuthResponse>;
  verifyEmail(token: string): Promise<VerifyEmailResponse>;
  resendVerification(email: string): Promise<ResendVerificationResponse>;
  /** Wisselt het **eigen** wachtwoord; de server pakt het account uit de sessie. */
  changePassword(body: ChangePasswordRequest): Promise<ChangePasswordResponse>;
  logout(): Promise<void>;
  listUsers(): Promise<UserListResponse>;
  createUser(body: CreateUserRequest): Promise<UserPublic>;
  updateSettings(id: string, body: UpdateSettingsRequest): Promise<UserPublic>;
  deleteUser(id: string): Promise<void>;
  /** Begeleider-account aanmaken binnen de eigen organisatie. ADMIN-only. */
  createCaregiverAccount(body: CreateCaregiverRequest): Promise<CreateCaregiverResponse>;
  /**
   * Logins van de eigen organisatie. ADMIN-only en tenant-gefilterd op de server. De
   * beheerder ziet hier per account of het e-mailadres bevestigd is en of het nog op het
   * tijdelijke wachtwoord uit T2.4 draait.
   */
  listAccounts(): Promise<AccountListResponse>;
  /**
   * Geeft een **nieuw** tijdelijk wachtwoord uit voor een account in de eigen organisatie.
   * ADMIN-only, nooit voor het eigen account (dat loopt via `changePassword`). Het wachtwoord komt
   * hier één keer terug; alle sessies van dat account zijn daarna ingetrokken.
   */
  resetAccountPassword(accountId: string): Promise<ResetAccountPasswordResponse>;
  listCaregivers(userId: string): Promise<CaregiverListResponse>;
  linkCaregiver(userId: string, accountId: string, linked: boolean): Promise<CaregiverListResponse>;
  generateDeviceCode(userId: string): Promise<DeviceCodeResponse>;
  /** Beheerdashboard: tenant-overzicht (gebruikers/begeleiders/activiteit) + openstaande voorstellen. */
  getDashboard(): Promise<DashboardResponse>;
  /** Audit-log van gevoelige acties van de eigen organisatie (nieuwste eerst) (INTENTO-NEW-DESIGN §53). */
  listAuditLogs(): Promise<AuditLogListResponse>;
  /** De Vocabulary van de eigen organisatie (platform + eigen), gepagineerd en doorzoekbaar. */
  listVocabulary(query?: Partial<VocabularyListQuery>): Promise<VocabularyListResponse>;
  /** Een item bewerken (alleen beheerder; platformitems alleen de platformbeheerder). */
  updateVocabularyItem(id: string, body: VocabularyUpdateRequest): Promise<VocabularyItemPublic>;
  /** De bronvermelding van de Vocabulary. */
  listAttributions(): Promise<AttributionListResponse>;
  /** Een item intrekken (`retire`) of terugzetten (`restore`). */
  setVocabularyItemStatus(id: string, action: 'retire' | 'restore'): Promise<VocabularyItemPublic>;
  /**
   * Platform-operatorconsole (INTENTO-NEW-DESIGN §53). Deze vijf calls gaan naar de aparte
   * `/operator`-routetak die bewust **over tenants heen** kijkt; alleen een operator-account komt
   * erdoorheen (403 `NOT_OPERATOR` voor al het andere). Ze leveren uitsluitend beheermetadata —
   * nooit communicatie-inhoud of persoonlijke context.
   */
  listOperatorOrganizations(): Promise<OperatorOrganizationListResponse>;
  createOperatorOrganization(
    body: CreateOperatorOrganizationRequest,
  ): Promise<OperatorOrganization>;
  getOperatorOrganization(id: string): Promise<OperatorOrganizationDetail>;
  deactivateOperatorOrganization(id: string): Promise<OperatorOrganization>;
  activateOperatorOrganization(id: string): Promise<OperatorOrganization>;
  /**
   * Laat één zin uitspreken met een **expliciete** stem, zodat de begeleider stemmen kan vergelijken
   * vóór hij er één kiest. Slaat niets op; de keuze wordt pas bij `updateSettings` bewaard.
   */
  speechPreview(userId: string, text: string, voice: string): Promise<Blob>;
  /** Versleuteld profiel van een gebruiker exporteren. */
  exportProfile(userId: string): Promise<ProfileExportResponse>;
  /** Een eerder geëxporteerd profiel importeren als nieuwe gebruiker in de eigen organisatie. */
  importProfile(body: ProfileImportRequest): Promise<UserPublic>;
}

/**
 * API-client voor de **gebruikersapp op de tablet**. Bewust losgekoppeld van de
 * beheer-`Api`: een gekoppeld apparaat werkt op device-auth (aparte cookie) en heeft alléén
 * toegang tot de eigen gebruiker en zijn gesprek — nooit tot beheer- of accountroutes. Zo hoeft
 * de tablet-UI geen beheermethodes te kennen en omgekeerd.
 */
export interface DeviceApi {
  /** Huidige apparaat-sessie (eigen gebruiker + communicatieprofiel); 401 als niet gekoppeld. */
  deviceMe(): Promise<DeviceSessionResponse>;
  /** Koppelcode inwisselen voor een apparaat-token (cookie) en de sessie teruggeven. */
  linkDevice(code: string): Promise<DeviceSessionResponse>;
  /** De bronvermelding van de Vocabulary (ook voor de tablet, INTENTO-NEW-DESIGN §15). */
  listAttributions(): Promise<AttributionListResponse>;
  /**
   * Laat de tekst op het scherm uitspreken. De **stem** komt uit het profiel van de gebruiker
   * achter de apparaatsessie; de tablet stuurt alleen de tekst mee. Werkt de spraakdienst niet, dan
   * gooit dit — de tablet valt dan terug op de stem van het apparaat zelf.
   */
  speakText(text: string): Promise<Blob>;
}

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/**
 * Maakt van een relatief backend-pad (zoals een AAC-afbeeldings-URL `/aac/images/:id`) een
 * absolute URL naar de API-host, zodat de web-client het als `<img src>` kan laden.
 */
export function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

/** Voert een request uit, mapt een backend-fout naar `ApiRequestError` en geeft de rauwe JSON terug. */
async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  // Bij een FormData-body (bestandsupload) zet de browser zélf de juiste
  // `Content-Type` met multipart-boundary; die mogen we niet overschrijven.
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Kan de server niet bereiken.');
  }

  if (response.status === 204) return undefined;

  const json: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    const code = parsed.success ? parsed.data.error.code : 'REQUEST_ERROR';
    const message = parsed.success ? parsed.data.error.message : 'Er ging iets mis.';
    throw new ApiRequestError(response.status, code, message);
  }

  return json;
}

/**
 * Zelfde als `request`, maar voor een **binaire** respons (T18.1: gesynthetiseerde spraak). De
 * backend geeft hier audio terug in plaats van JSON; fouten houden wél de gewone JSON-foutvorm, dus
 * die worden op dezelfde manier naar `ApiRequestError` vertaald.
 */
async function requestAudio(path: string, body: unknown): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'audio/wav', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Kan de server niet bereiken.');
  }

  if (!response.ok) {
    const json: unknown = await response.json().catch(() => undefined);
    const parsed = apiErrorSchema.safeParse(json);
    throw new ApiRequestError(
      response.status,
      parsed.success ? parsed.data.error.code : 'REQUEST_ERROR',
      parsed.success ? parsed.data.error.message : 'Er ging iets mis.',
    );
  }

  return response.blob();
}

/** De echte, op `fetch` gebaseerde client (standaard in productie). */
export const httpApi: Api & DeviceApi = {
  async me() {
    return authResponseSchema.parse(await request('/auth/me'));
  },
  async login(email, password) {
    return authResponseSchema.parse(
      await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    );
  },
  async register(body) {
    return authResponseSchema.parse(
      await request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
    );
  },
  async verifyEmail(token) {
    return verifyEmailResponseSchema.parse(
      await request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
    );
  },
  async resendVerification(email) {
    return resendVerificationResponseSchema.parse(
      await request('/auth/verify-email/resend', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    );
  },
  async changePassword(body) {
    return changePasswordResponseSchema.parse(
      await request('/auth/password', { method: 'POST', body: JSON.stringify(body) }),
    );
  },
  async logout() {
    await request('/auth/logout', { method: 'POST' });
  },
  async listUsers() {
    return userListResponseSchema.parse(await request('/admin/users'));
  },
  async createUser(body) {
    return userPublicSchema.parse(
      await request('/users', { method: 'POST', body: JSON.stringify(body) }),
    );
  },
  async updateSettings(id, body) {
    return userPublicSchema.parse(
      await request(`/users/${id}/settings`, { method: 'PUT', body: JSON.stringify(body) }),
    );
  },
  async deleteUser(id) {
    await request(`/users/${id}`, { method: 'DELETE' });
  },
  async createCaregiverAccount(body) {
    return createCaregiverResponseSchema.parse(
      await request('/admin/accounts', { method: 'POST', body: JSON.stringify(body) }),
    );
  },
  async listAccounts() {
    return accountListResponseSchema.parse(await request('/admin/accounts'));
  },
  async resetAccountPassword(accountId) {
    return resetAccountPasswordResponseSchema.parse(
      await request(`/admin/accounts/${accountId}/password`, { method: 'POST' }),
    );
  },
  async listCaregivers(userId) {
    return caregiverListResponseSchema.parse(await request(`/admin/users/${userId}/caregivers`));
  },
  async linkCaregiver(userId, accountId, linked) {
    return caregiverListResponseSchema.parse(
      await request(`/admin/users/${userId}/caregivers`, {
        method: 'POST',
        body: JSON.stringify({ accountId, linked }),
      }),
    );
  },
  async generateDeviceCode(userId) {
    return deviceCodeResponseSchema.parse(
      await request(`/admin/users/${userId}/device-code`, { method: 'POST', body: '{}' }),
    );
  },
  async getDashboard() {
    return dashboardResponseSchema.parse(await request('/admin/dashboard'));
  },
  async listAuditLogs() {
    return auditLogListResponseSchema.parse(await request('/admin/audit-logs'));
  },
  async listVocabulary(query = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    const suffix = qs ? `?${qs}` : '';
    return vocabularyListResponseSchema.parse(await request(`/vocabulary${suffix}`));
  },
  async listAttributions() {
    return attributionListResponseSchema.parse(await request('/vocabulary/attributions'));
  },
  async setVocabularyItemStatus(id, action) {
    return vocabularyItemPublicSchema.parse(
      await request(`/vocabulary/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        body: '{}',
      }),
    );
  },
  async updateVocabularyItem(id, body) {
    return vocabularyItemPublicSchema.parse(
      await request(`/vocabulary/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    );
  },
  async listOperatorOrganizations() {
    return operatorOrganizationListResponseSchema.parse(await request('/operator/organizations'));
  },
  async createOperatorOrganization(body) {
    return operatorOrganizationSchema.parse(
      await request('/operator/organizations', { method: 'POST', body: JSON.stringify(body) }),
    );
  },
  async getOperatorOrganization(id) {
    return operatorOrganizationDetailSchema.parse(
      await request(`/operator/organizations/${encodeURIComponent(id)}`),
    );
  },
  async deactivateOperatorOrganization(id) {
    return operatorOrganizationSchema.parse(
      await request(`/operator/organizations/${encodeURIComponent(id)}/deactivate`, {
        method: 'POST',
        body: '{}',
      }),
    );
  },
  async activateOperatorOrganization(id) {
    return operatorOrganizationSchema.parse(
      await request(`/operator/organizations/${encodeURIComponent(id)}/activate`, {
        method: 'POST',
        body: '{}',
      }),
    );
  },
  async speechPreview(userId, text, voice) {
    return requestAudio(`/admin/users/${userId}/speech-preview`, { text, voice });
  },
  async speakText(text) {
    return requestAudio('/device/speech', { text });
  },
  async exportProfile(userId) {
    return profileExportResponseSchema.parse(await request(`/users/${userId}/export`));
  },
  async importProfile(body) {
    return userPublicSchema.parse(
      await request('/users/import', { method: 'POST', body: JSON.stringify(body) }),
    );
  },
  async deviceMe() {
    return deviceSessionResponseSchema.parse(await request('/device/me'));
  },
  async linkDevice(code) {
    return deviceSessionResponseSchema.parse(
      await request('/devices/link', { method: 'POST', body: JSON.stringify({ code }) }),
    );
  },
};
