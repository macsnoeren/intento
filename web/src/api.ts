import {
  aacSearchResponseSchema,
  aacTopicListResponseSchema,
  accountListResponseSchema,
  aacSymbolAdminSchema,
  aacSymbolListResponseSchema,
  aiJobListResponseSchema,
  aiStatusResponseSchema,
  aiWaitingErrorSchema,
  apiErrorSchema,
  auditLogListResponseSchema,
  authResponseSchema,
  changePasswordResponseSchema,
  caregiverConversationViewSchema,
  caregiverListResponseSchema,
  conceptProposalSchema,
  conceptProposalListResponseSchema,
  dashboardResponseSchema,
  profileExportResponseSchema,
  conversationConfirmResponseSchema,
  conversationGenerateResponseSchema,
  conversationStateResponseSchema,
  createCaregiverResponseSchema,
  createWorkerTokenResponseSchema,
  deviceCodeResponseSchema,
  deviceSessionResponseSchema,
  openSymbolsSearchResponseSchema,
  operatorOrganizationDetailSchema,
  operatorOrganizationListResponseSchema,
  operatorOrganizationSchema,
  pendingQuestionResponseSchema,
  personalContextListResponseSchema,
  personalContextPublicSchema,
  preferenceListResponseSchema,
  preferencePublicSchema,
  questionStartResponseSchema,
  resendVerificationResponseSchema,
  resetAccountPasswordResponseSchema,
  userListResponseSchema,
  userPublicSchema,
  verifyEmailResponseSchema,
  workerTokenListResponseSchema,
  workerTokenPublicSchema,
  type AccountListResponse,
  type AacSearchResponse,
  type AacSymbolAdmin,
  type AacSymbolInput,
  type AacSymbolListResponse,
  type AacTopicListResponse,
  type AiJobListResponse,
  type AiStatusResponse,
  type AttachOpenSymbolsRequest,
  type AuditLogListResponse,
  type AuthResponse,
  type ChangePasswordRequest,
  type ChangePasswordResponse,
  type CreateCaregiverRequest,
  type CreateCaregiverResponse,
  type CaregiverConversationView,
  type CaregiverListResponse,
  type ConceptProposal,
  type ConceptProposalListResponse,
  type ConversationConfirmResponse,
  type ConversationCorrectionType,
  type DashboardResponse,
  type ConversationGenerateResponse,
  type ConversationStateResponse,
  type CreateUserRequest,
  type CreateWorkerTokenRequest,
  type CreateWorkerTokenResponse,
  type DeviceCodeResponse,
  type DeviceSessionResponse,
  type CreateOperatorOrganizationRequest,
  type OpenSymbolsSearchResponse,
  type OperatorOrganization,
  type OperatorOrganizationDetail,
  type OperatorOrganizationListResponse,
  type PendingQuestionResponse,
  type PersonalContextInput,
  type PersonalContextListResponse,
  type PersonalContextPublic,
  type PreferenceListResponse,
  type PreferencePublic,
  type PreferenceSuggestionAction,
  type ProfileExportResponse,
  type ProfileImportRequest,
  type QuestionStartRequest,
  type QuestionStartResponse,
  type RegisterRequest,
  type ResendVerificationResponse,
  type ResetAccountPasswordResponse,
  type UpdateSettingsRequest,
  type UserListResponse,
  type UserPublic,
  type VerifyEmailResponse,
  type WorkerTokenListResponse,
  type WorkerTokenPublic,
} from '@intento/shared';

/**
 * API-client voor de web-app.
 *
 * De client praat via de backend (nooit rechtstreeks met de AI of db, DESIGN §8.1). Alle
 * requests sturen de sessie-cookie mee (`credentials: 'include'`) en alle responses worden
 * met de gedeelde zod-schema's gevalideerd, zodat client en server nooit uit elkaar lopen.
 *
 * De `Api`-interface maakt de datalaag injecteerbaar: componenten krijgen 'm als prop, zodat
 * tests een in-memory implementatie kunnen meegeven zonder echte netwerkcalls.
 */

/** Foutstructuur van de backend (DESIGN §8.1), als gooibare Error met code + HTTP-status. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /**
     * Voorgestelde wachttijd (ms) bij een "even wachten"-503 van de AI-wachtrij
     * (`AI_WORKER_BUSY`/`AI_WORKER_UNAVAILABLE`, T5.7). Spiegelt de `Retry-After`-header.
     */
    readonly retryAfterMs?: number,
    /** Positie in de AI-wachtrij (1-based) bij `AI_WORKER_BUSY`. */
    readonly position?: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Herkent de "even wachten"-503's van de gedistribueerde AI-wachtrij (T5.7, ADR-0010): alle
 * workers bezet (`AI_WORKER_BUSY`) of tijdelijk geen worker beschikbaar (`AI_WORKER_UNAVAILABLE`).
 * De tablet-UI toont dan geen fout maar een rustige wachtstand en polt automatisch opnieuw.
 */
export function isAiWaitingError(err: unknown): err is ApiRequestError {
  return (
    err instanceof ApiRequestError &&
    (err.code === 'AI_WORKER_BUSY' || err.code === 'AI_WORKER_UNAVAILABLE')
  );
}

export interface Api {
  me(): Promise<AuthResponse>;
  login(email: string, password: string): Promise<AuthResponse>;
  register(body: RegisterRequest): Promise<AuthResponse>;
  verifyEmail(token: string): Promise<VerifyEmailResponse>;
  resendVerification(email: string): Promise<ResendVerificationResponse>;
  /** Wisselt het **eigen** wachtwoord (T2.5); de server pakt het account uit de sessie. */
  changePassword(body: ChangePasswordRequest): Promise<ChangePasswordResponse>;
  logout(): Promise<void>;
  listUsers(): Promise<UserListResponse>;
  createUser(body: CreateUserRequest): Promise<UserPublic>;
  updateSettings(id: string, body: UpdateSettingsRequest): Promise<UserPublic>;
  deleteUser(id: string): Promise<void>;
  /** Begeleider-account aanmaken binnen de eigen organisatie (T2.4). ADMIN-only. */
  createCaregiverAccount(body: CreateCaregiverRequest): Promise<CreateCaregiverResponse>;
  /**
   * Logins van de eigen organisatie (T2.6). ADMIN-only en tenant-gefilterd op de server. De
   * beheerder ziet hier per account of het e-mailadres bevestigd is en of het nog op het
   * tijdelijke wachtwoord uit T2.4 draait.
   */
  listAccounts(): Promise<AccountListResponse>;
  /**
   * Geeft een **nieuw** tijdelijk wachtwoord uit voor een account in de eigen organisatie (T2.7).
   * ADMIN-only, nooit voor het eigen account (dat loopt via `changePassword`). Het wachtwoord komt
   * hier één keer terug; alle sessies van dat account zijn daarna ingetrokken.
   */
  resetAccountPassword(accountId: string): Promise<ResetAccountPasswordResponse>;
  listCaregivers(userId: string): Promise<CaregiverListResponse>;
  linkCaregiver(userId: string, accountId: string, linked: boolean): Promise<CaregiverListResponse>;
  generateDeviceCode(userId: string): Promise<DeviceCodeResponse>;
  listAacSymbols(filter?: { q?: string; category?: string }): Promise<AacSymbolListResponse>;
  createAacSymbol(body: AacSymbolInput): Promise<AacSymbolAdmin>;
  updateAacSymbol(id: string, body: AacSymbolInput): Promise<AacSymbolAdmin>;
  deleteAacSymbol(id: string): Promise<void>;
  uploadAacImage(id: string, file: File): Promise<AacSymbolAdmin>;
  createAacRelation(parentId: string, childId: string): Promise<AacSymbolAdmin>;
  deleteAacRelation(id: string): Promise<void>;
  searchOpenSymbols(q: string): Promise<OpenSymbolsSearchResponse>;
  attachOpenSymbols(id: string, body: AttachOpenSymbolsRequest): Promise<AacSymbolAdmin>;
  listWorkerTokens(): Promise<WorkerTokenListResponse>;
  createWorkerToken(body: CreateWorkerTokenRequest): Promise<CreateWorkerTokenResponse>;
  revokeWorkerToken(id: string): Promise<WorkerTokenPublic>;
  listPersonalContext(userId: string): Promise<PersonalContextListResponse>;
  createPersonalContext(userId: string, body: PersonalContextInput): Promise<PersonalContextPublic>;
  updatePersonalContext(
    userId: string,
    contextId: string,
    body: PersonalContextInput,
  ): Promise<PersonalContextPublic>;
  deletePersonalContext(userId: string, contextId: string): Promise<void>;
  listPreferences(userId: string): Promise<PreferenceListResponse>;
  resolveSuggestion(
    userId: string,
    prefId: string,
    body: PreferenceSuggestionAction,
  ): Promise<PreferencePublic>;
  /** Zoekt AAC-symbolen (concept/label/synoniem) — o.a. voor de topic-keuze in de vraagmodus (T7.1). */
  searchAac(q: string): Promise<AacSearchResponse>;
  /**
   * De onderwerpen die antwoordopties hebben en dus als anker van een begeleidersvraag kunnen dienen
   * (T9.7). Vult de keuzelijst in de vraagmodus, zodat de begeleider niet eerst hoeft te zoeken.
   */
  listAacTopics(): Promise<AacTopicListResponse>;
  /** Draait er een echte AI mee en is er een worker actief? (T9.4) Alleen infrastructuurmetadata. */
  getAiStatus(): Promise<AiStatusResponse>;
  /**
   * De recentste AI-aanvragen met wat de AI eruit gaf (T9.15) — platformbeheer, nooit de prompt.
   * Een gewone organisatie-ADMIN krijgt 403 `NOT_PLATFORM_ADMIN`.
   */
  listAiJobs(): Promise<AiJobListResponse>;
  /** Gebruikers aan wie dit account (begeleider/beheerder) een vraag mag stellen (vraagmodus, T7.1). */
  listQuestionUsers(): Promise<UserListResponse>;
  /** Start een vraagmodus-sessie: de vraag verschijnt in de gebruikersapp op de tablet (T7.1). */
  startQuestion(body: QuestionStartRequest): Promise<QuestionStartResponse>;
  /** Read-only meekijken met het lopende gesprek van een gekoppelde gebruiker (T7.2, DESIGN §3.3). */
  viewUserConversation(userId: string): Promise<CaregiverConversationView>;
  /** Beheerdashboard: tenant-overzicht (gebruikers/begeleiders/activiteit) + openstaande voorstellen (T7.3). */
  getDashboard(): Promise<DashboardResponse>;
  /** Audit-log van gevoelige acties van de eigen organisatie (nieuwste eerst) (T8.2, DESIGN §9.4). */
  listAuditLogs(): Promise<AuditLogListResponse>;
  /**
   * Platform-operatorconsole (T8.3, DESIGN §9.1, §9.4). Deze vijf calls gaan naar de aparte
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
  /** AI-conceptvoorstellen ter beoordeling (openstaande eerst) (T7.3, FR-016). */
  listConceptProposals(): Promise<ConceptProposalListResponse>;
  /** Voorstel goedkeuren: koppel het begrip aan een bestaand pictogram (daarna bruikbaar voor de AI). */
  approveConceptProposal(id: string, symbolId: string): Promise<ConceptProposal>;
  /** Voorstel afwijzen: het begrip blijft buiten de AAC-begrenzing. */
  rejectConceptProposal(id: string): Promise<ConceptProposal>;
  /** Versleuteld profiel van een gebruiker exporteren (T8.1, FR-019). */
  exportProfile(userId: string): Promise<ProfileExportResponse>;
  /** Een eerder geëxporteerd profiel importeren als nieuwe gebruiker in de eigen organisatie (T8.1). */
  importProfile(body: ProfileImportRequest): Promise<UserPublic>;
}

/**
 * API-client voor de **gebruikersapp op de tablet** (T4.2). Bewust losgekoppeld van de
 * beheer-`Api`: een gekoppeld apparaat werkt op device-auth (aparte cookie) en heeft alléén
 * toegang tot de eigen gebruiker en zijn gesprek — nooit tot beheer- of accountroutes. Zo hoeft
 * de tablet-UI geen beheermethodes te kennen en omgekeerd.
 */
export interface DeviceApi {
  /** Huidige apparaat-sessie (eigen gebruiker + communicatieprofiel); 401 als niet gekoppeld. */
  deviceMe(): Promise<DeviceSessionResponse>;
  /** Koppelcode inwisselen voor een apparaat-token (cookie) en de sessie teruggeven. */
  linkDevice(code: string): Promise<DeviceSessionResponse>;
  /** Nieuw gesprek starten; geeft de startvraag (intentie-categorieën) terug. */
  startConversation(): Promise<ConversationStateResponse>;
  /** Keuze insturen → volgende vraag + opties (of `done`). */
  conversationNext(sessionId: string, symbolId: string): Promise<ConversationStateResponse>;
  /** Laatste keuze ongedaan maken; herstelt de vorige vraag/opties exact. */
  conversationBack(sessionId: string): Promise<ConversationStateResponse>;
  /**
   * "Dit klopt niet" (T5.4/T9.12). `wrong_guess` (standaard) wijst het **voorstel** af: heranalyse →
   * gerichtere hervraag op de vermoedelijke foutstap. `no_fitting_option` betekent dat het juiste
   * pictogram niet tussen de aangeboden opties staat: dit punt wordt overgeslagen en het gesprek gaat
   * met andere opties verder, zonder een gemaakte keuze terug te rollen.
   */
  conversationCorrection(
    sessionId: string,
    type?: ConversationCorrectionType,
  ): Promise<ConversationStateResponse>;
  /** Boodschap laten voorstellen uit de gekozen concepten (sjabloon-zin + confidence; slaat niets op). */
  conversationGenerate(sessionId: string): Promise<ConversationGenerateResponse>;
  /** Boodschap bevestigen → sessie afronden en de boodschap opslaan. */
  conversationConfirm(sessionId: string): Promise<ConversationConfirmResponse>;
  /**
   * Openstaande begeleidersvraag ophalen (vraagmodus, T7.1). Geeft de gesprekstoestand van een
   * klaarstaande vraag terug, of `null` als er geen is — dan start de tablet een vrij gesprek.
   */
  getPendingQuestion(): Promise<PendingQuestionResponse>;
  /**
   * Draait er een echte AI mee (T9.4)? De tablet toont het als een klein lampje, zodat gebruiker en
   * begeleider zien dát er een AI meedenkt — of juist niet.
   */
  getAiStatus(): Promise<AiStatusResponse>;
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
    // Bij de AI-wachtrij-503's (T5.7) draagt het body extra velden (retryAfterMs/position) die de
    // UI gebruikt om te wachten en te pollen; anders blijven ze simpelweg undefined.
    const waiting = aiWaitingErrorSchema.safeParse(json);
    throw new ApiRequestError(
      response.status,
      code,
      message,
      waiting.success ? waiting.data.retryAfterMs : undefined,
      waiting.success ? waiting.data.position : undefined,
    );
  }

  return json;
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
  async listAacSymbols(filter) {
    const params = new URLSearchParams();
    if (filter?.q) params.set('q', filter.q);
    if (filter?.category) params.set('category', filter.category);
    const query = params.toString();
    return aacSymbolListResponseSchema.parse(
      await request(`/admin/aac/symbols${query ? `?${query}` : ''}`),
    );
  },
  async createAacSymbol(body) {
    return aacSymbolAdminSchema.parse(
      await request('/admin/aac/symbols', { method: 'POST', body: JSON.stringify(body) }),
    );
  },
  async updateAacSymbol(id, body) {
    return aacSymbolAdminSchema.parse(
      await request(`/admin/aac/symbols/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    );
  },
  async deleteAacSymbol(id) {
    await request(`/admin/aac/symbols/${id}`, { method: 'DELETE' });
  },
  async uploadAacImage(id, file) {
    const form = new FormData();
    form.append('file', file);
    return aacSymbolAdminSchema.parse(
      await request(`/admin/aac/symbols/${id}/image`, { method: 'POST', body: form }),
    );
  },
  async createAacRelation(parentId, childId) {
    return aacSymbolAdminSchema.parse(
      await request('/admin/aac/relations', {
        method: 'POST',
        body: JSON.stringify({ parentId, childId }),
      }),
    );
  },
  async deleteAacRelation(id) {
    await request(`/admin/aac/relations/${id}`, { method: 'DELETE' });
  },
  async searchOpenSymbols(q) {
    const params = new URLSearchParams({ q });
    return openSymbolsSearchResponseSchema.parse(
      await request(`/admin/aac/opensymbols/search?${params.toString()}`),
    );
  },
  async attachOpenSymbols(id, body) {
    return aacSymbolAdminSchema.parse(
      await request(`/admin/aac/symbols/${id}/opensymbols`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
  },
  async listWorkerTokens() {
    return workerTokenListResponseSchema.parse(await request('/admin/worker-tokens'));
  },
  async createWorkerToken(body) {
    return createWorkerTokenResponseSchema.parse(
      await request('/admin/worker-tokens', { method: 'POST', body: JSON.stringify(body) }),
    );
  },
  async revokeWorkerToken(id) {
    return workerTokenPublicSchema.parse(
      await request(`/admin/worker-tokens/${id}/revoke`, { method: 'POST', body: '{}' }),
    );
  },
  async listPersonalContext(userId) {
    return personalContextListResponseSchema.parse(await request(`/users/${userId}/context`));
  },
  async createPersonalContext(userId, body) {
    return personalContextPublicSchema.parse(
      await request(`/users/${userId}/context`, { method: 'POST', body: JSON.stringify(body) }),
    );
  },
  async updatePersonalContext(userId, contextId, body) {
    return personalContextPublicSchema.parse(
      await request(`/users/${userId}/context/${contextId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    );
  },
  async deletePersonalContext(userId, contextId) {
    await request(`/users/${userId}/context/${contextId}`, { method: 'DELETE' });
  },
  async listPreferences(userId) {
    return preferenceListResponseSchema.parse(await request(`/users/${userId}/preferences`));
  },
  async resolveSuggestion(userId, prefId, body) {
    return preferencePublicSchema.parse(
      await request(`/users/${userId}/preferences/${prefId}/suggestion`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
  },
  async searchAac(q) {
    const params = new URLSearchParams({ q });
    return aacSearchResponseSchema.parse(await request(`/aac/search?${params.toString()}`));
  },
  async listAacTopics() {
    return aacTopicListResponseSchema.parse(await request('/aac/topics'));
  },
  async getAiStatus() {
    return aiStatusResponseSchema.parse(await request('/ai/status'));
  },
  async listAiJobs() {
    return aiJobListResponseSchema.parse(await request('/admin/ai/jobs'));
  },
  async listQuestionUsers() {
    return userListResponseSchema.parse(await request('/question/users'));
  },
  async startQuestion(body) {
    return questionStartResponseSchema.parse(
      await request('/question/start', { method: 'POST', body: JSON.stringify(body) }),
    );
  },
  async viewUserConversation(userId) {
    return caregiverConversationViewSchema.parse(
      await request(`/question/users/${userId}/conversation`),
    );
  },
  async getDashboard() {
    return dashboardResponseSchema.parse(await request('/admin/dashboard'));
  },
  async listAuditLogs() {
    return auditLogListResponseSchema.parse(await request('/admin/audit-logs'));
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
  async listConceptProposals() {
    return conceptProposalListResponseSchema.parse(await request('/admin/concept-proposals'));
  },
  async approveConceptProposal(id, symbolId) {
    return conceptProposalSchema.parse(
      await request(`/admin/concept-proposals/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ symbolId }),
      }),
    );
  },
  async rejectConceptProposal(id) {
    return conceptProposalSchema.parse(
      await request(`/admin/concept-proposals/${id}/reject`, { method: 'POST', body: '{}' }),
    );
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
  async startConversation() {
    return conversationStateResponseSchema.parse(
      await request('/conversation/start', { method: 'POST', body: '{}' }),
    );
  },
  async conversationNext(sessionId, symbolId) {
    return conversationStateResponseSchema.parse(
      await request(`/conversation/${sessionId}/next`, {
        method: 'POST',
        body: JSON.stringify({ symbolId }),
      }),
    );
  },
  async conversationBack(sessionId) {
    return conversationStateResponseSchema.parse(
      await request(`/conversation/${sessionId}/back`, { method: 'POST', body: '{}' }),
    );
  },
  async conversationCorrection(sessionId, type = 'wrong_guess') {
    return conversationStateResponseSchema.parse(
      await request(`/conversation/${sessionId}/correction`, {
        method: 'POST',
        body: JSON.stringify({ type }),
      }),
    );
  },
  async conversationGenerate(sessionId) {
    return conversationGenerateResponseSchema.parse(
      await request(`/conversation/${sessionId}/generate`, { method: 'POST', body: '{}' }),
    );
  },
  async conversationConfirm(sessionId) {
    return conversationConfirmResponseSchema.parse(
      await request(`/conversation/${sessionId}/confirm`, { method: 'POST', body: '{}' }),
    );
  },
  async getPendingQuestion() {
    return pendingQuestionResponseSchema.parse(await request('/conversation/pending'));
  },
};
