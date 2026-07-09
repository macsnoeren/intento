import {
  aacSymbolAdminSchema,
  aacSymbolListResponseSchema,
  apiErrorSchema,
  authResponseSchema,
  caregiverListResponseSchema,
  deviceCodeResponseSchema,
  openSymbolsSearchResponseSchema,
  userListResponseSchema,
  userPublicSchema,
  type AacSymbolAdmin,
  type AacSymbolInput,
  type AacSymbolListResponse,
  type AttachOpenSymbolsRequest,
  type AuthResponse,
  type CaregiverListResponse,
  type CreateUserRequest,
  type DeviceCodeResponse,
  type OpenSymbolsSearchResponse,
  type RegisterRequest,
  type UpdateSettingsRequest,
  type UserListResponse,
  type UserPublic,
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
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface Api {
  me(): Promise<AuthResponse>;
  login(email: string, password: string): Promise<AuthResponse>;
  register(body: RegisterRequest): Promise<AuthResponse>;
  logout(): Promise<void>;
  listUsers(): Promise<UserListResponse>;
  createUser(body: CreateUserRequest): Promise<UserPublic>;
  updateSettings(id: string, body: UpdateSettingsRequest): Promise<UserPublic>;
  deleteUser(id: string): Promise<void>;
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

/** De echte, op `fetch` gebaseerde client (standaard in productie). */
export const httpApi: Api = {
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
};
