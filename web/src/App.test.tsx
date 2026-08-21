import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  AccountListResponse,
  AuthResponse,
  CaregiverLink,
  ChangePasswordResponse,
  CaregiverListResponse,
  CreateCaregiverRequest,
  CreateCaregiverResponse,
  CreateUserRequest,
  CreateWorkerTokenRequest,
  CreateWorkerTokenResponse,
  DeviceCodeResponse,
  PersonalContextPublic,
  ResendVerificationResponse,
  ResetAccountPasswordResponse,
  UpdateSettingsRequest,
  UserListResponse,
  UserPublic,
  VerifyEmailResponse,
  WorkerTokenListResponse,
  WorkerTokenPublic,
} from '@intento/shared';
import { App } from './App.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor de beheeromgeving (T2.1). Draaien tegen een in-memory `Api`, zodat de
 * volledige beheerflow (inloggen → gebruiker aanmaken → instellingen → verwijderen) zonder
 * netwerk getest wordt. De echte HTTP-client wordt server-side gedekt door de API-tests.
 */

const adminAccount = {
  id: 'acc-1',
  email: 'admin@intento.local',
  role: 'ADMIN' as const,
  organizationId: 'org-1',
  name: null,
  emailVerified: true,
  mustChangePassword: false,
  isOperator: false,
};

function makeUser(id: string, name: string): UserPublic {
  return {
    id,
    name,
    organizationId: 'org-1',
    active: true,
    createdAt: '2026-07-08T10:00:00.000Z',
    communicationProfile: {
      iconsPerScreen: 4,
      showText: true,
      aiLearningEnabled: true,
      supportMode: false,
      contextIndicator: true,
    },
  };
}

/** Bouwt een stateful nep-backend; `loggedIn` bepaalt of er al een sessie is. */
function fakeApi(
  options: {
    loggedIn?: boolean;
    caregivers?: CaregiverLink[];
    emailVerified?: boolean;
    /** Simuleer een account dat nog op zijn tijdelijke wachtwoord uit T2.4 zit (T2.6). */
    mustChangePassword?: boolean;
    /** Simuleer een niet-platform-ADMIN: worker-token-endpoints geven 403 NOT_PLATFORM_ADMIN. */
    workerTokensForbidden?: boolean;
  } = {},
): Api {
  let session = options.loggedIn ?? false;
  let emailVerified = options.emailVerified ?? true;
  let mustChangePassword = options.mustChangePassword ?? false;
  const account = (): typeof adminAccount => ({
    ...adminAccount,
    emailVerified,
    mustChangePassword,
  });
  const users: UserPublic[] = [];
  let counter = 0;
  // In-memory worker-tokenstore (T5.8).
  const workerTokens: WorkerTokenPublic[] = [];
  // In-memory persoonlijke-contextstore per gebruiker (T6.2).
  const contextsByUser = new Map<string, PersonalContextPublic[]>();
  // Koppelingen per gebruiker; de begeleiderlijst zelf is organisatiebreed (uit `options`).
  const caregiverSeed = options.caregivers ?? [];
  let caregiverCounter = caregiverSeed.length;
  const linksByUser = new Map<string, Set<string>>();

  function caregiversFor(userId: string): CaregiverLink[] {
    const linked = linksByUser.get(userId) ?? new Set<string>();
    return caregiverSeed.map((c) => ({ ...c, linked: linked.has(c.accountId) }));
  }

  return {
    me(): Promise<AuthResponse> {
      return session
        ? Promise.resolve({ account: account() })
        : Promise.reject(new ApiRequestError(401, 'NOT_AUTHENTICATED', 'Niet ingelogd.'));
    },
    login(email: string): Promise<AuthResponse> {
      if (email !== adminAccount.email) {
        return Promise.reject(
          new ApiRequestError(401, 'INVALID_CREDENTIALS', 'Onjuiste e-mail of wachtwoord.'),
        );
      }
      session = true;
      return Promise.resolve({ account: account() });
    },
    register(): Promise<AuthResponse> {
      // Zelfaanmelding maakt een nieuwe omgeving + admin en logt meteen in (T1.3).
      session = true;
      return Promise.resolve({ account: account() });
    },
    verifyEmail(): Promise<VerifyEmailResponse> {
      emailVerified = true;
      return Promise.resolve({ verified: true, account: account() });
    },
    resendVerification(): Promise<ResendVerificationResponse> {
      return Promise.resolve({ message: 'Als het adres bekend is, is er een mail verstuurd.' });
    },
    changePassword(): Promise<ChangePasswordResponse> {
      // Zoals de server (T2.6): een geslaagde wijziging heft de tijdelijk-wachtwoord-markering op.
      mustChangePassword = false;
      return Promise.resolve({ revokedSessions: 0 });
    },
    logout(): Promise<void> {
      session = false;
      return Promise.resolve();
    },
    listUsers(): Promise<UserListResponse> {
      return Promise.resolve({ users: [...users] });
    },
    createUser(body: CreateUserRequest): Promise<UserPublic> {
      const user = makeUser(`u-${++counter}`, body.name);
      users.push(user);
      return Promise.resolve(user);
    },
    updateSettings(id: string, body: UpdateSettingsRequest): Promise<UserPublic> {
      const index = users.findIndex((u) => u.id === id);
      const updated = { ...users[index]!, communicationProfile: body };
      users[index] = updated;
      return Promise.resolve(updated);
    },
    deleteUser(id: string): Promise<void> {
      const index = users.findIndex((u) => u.id === id);
      if (index >= 0) users.splice(index, 1);
      return Promise.resolve();
    },
    createCaregiverAccount(body: CreateCaregiverRequest): Promise<CreateCaregiverResponse> {
      // Server-gedrag nagebootst (T2.4): rol vast op CAREGIVER, eigen organisatie, tijdelijk
      // wachtwoord uit de backend. Het account komt meteen in de organisatiebrede begeleiderlijst.
      const account = {
        id: `cg-${++caregiverCounter}`,
        email: body.email,
        role: 'CAREGIVER' as const,
        organizationId: adminAccount.organizationId,
        name: body.name,
        emailVerified: false,
        // Een vers account draait nog op het tijdelijke wachtwoord dat de server teruggaf (T2.6).
        mustChangePassword: true,
        isOperator: false,
      };
      caregiverSeed.push({
        accountId: account.id,
        email: account.email,
        role: 'CAREGIVER',
        linked: false,
      });
      return Promise.resolve({ account, temporaryPassword: 'tijdelijk-wachtwoord-123' });
    },
    listAccounts(): Promise<AccountListResponse> {
      // De beheerder zelf plus elke aangemaakte begeleider (die nog op zijn tijdelijke
      // wachtwoord zit) — de accountlijst van T2.6.
      return Promise.resolve({
        accounts: [
          account(),
          ...caregiverSeed.map((c) => ({
            id: c.accountId,
            email: c.email,
            role: 'CAREGIVER' as const,
            organizationId: adminAccount.organizationId,
            name: null,
            emailVerified: false,
            mustChangePassword: true,
            isOperator: false,
          })),
        ],
      });
    },
    resetAccountPassword(accountId: string): Promise<ResetAccountPasswordResponse> {
      // Server-gedrag nagebootst (T2.7): nieuw server-gegenereerd wachtwoord, account weer
      // gemarkeerd, alle sessies van dat account ingetrokken.
      const caregiver = caregiverSeed.find((c) => c.accountId === accountId);
      return Promise.resolve({
        account: {
          id: accountId,
          email: caregiver?.email ?? 'onbekend@intento.local',
          role: 'CAREGIVER' as const,
          organizationId: adminAccount.organizationId,
          name: null,
          emailVerified: false,
          mustChangePassword: true,
          isOperator: false,
        },
        temporaryPassword: 'nieuw-tijdelijk-wachtwoord-456',
        revokedSessions: 1,
      });
    },
    listCaregivers(userId: string): Promise<CaregiverListResponse> {
      return Promise.resolve({ caregivers: caregiversFor(userId) });
    },
    linkCaregiver(
      userId: string,
      accountId: string,
      linked: boolean,
    ): Promise<CaregiverListResponse> {
      const set = linksByUser.get(userId) ?? new Set<string>();
      if (linked) set.add(accountId);
      else set.delete(accountId);
      linksByUser.set(userId, set);
      return Promise.resolve({ caregivers: caregiversFor(userId) });
    },
    generateDeviceCode(): Promise<DeviceCodeResponse> {
      return Promise.resolve({ code: 'ABCD2345', expiresAt: '2026-07-08T10:15:00.000Z' });
    },
    // AAC-beheer wordt in AacLibraryPage.test.tsx apart gedekt; hier alleen stubs zodat de
    // beheeromgeving-tests tegen de volledige `Api` compileren (standaardweergave is Gebruikers).
    listAacSymbols() {
      return Promise.resolve({ symbols: [] });
    },
    createAacSymbol() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'stub'));
    },
    updateAacSymbol() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'stub'));
    },
    deleteAacSymbol() {
      return Promise.resolve();
    },
    uploadAacImage() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'stub'));
    },
    createAacRelation() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'stub'));
    },
    deleteAacRelation() {
      return Promise.resolve();
    },
    searchOpenSymbols() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'stub'));
    },
    attachOpenSymbols() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'stub'));
    },
    listWorkerTokens(): Promise<WorkerTokenListResponse> {
      if (options.workerTokensForbidden) {
        return Promise.reject(
          new ApiRequestError(403, 'NOT_PLATFORM_ADMIN', 'Alleen een platformbeheerder.'),
        );
      }
      return Promise.resolve({ tokens: [...workerTokens] });
    },
    createWorkerToken(body: CreateWorkerTokenRequest): Promise<CreateWorkerTokenResponse> {
      if (options.workerTokensForbidden) {
        return Promise.reject(
          new ApiRequestError(403, 'NOT_PLATFORM_ADMIN', 'Alleen een platformbeheerder.'),
        );
      }
      const token: WorkerTokenPublic = {
        id: `wt-${++counter}`,
        name: body.name,
        scopes: body.scopes ?? ['ai:process'],
        status: 'active',
        lastSeenAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: '2026-07-11T10:00:00.000Z',
      };
      workerTokens.unshift(token);
      return Promise.resolve({ workerToken: token, token: `wrk_raw-${token.id}` });
    },
    revokeWorkerToken(id: string): Promise<WorkerTokenPublic> {
      const index = workerTokens.findIndex((t) => t.id === id);
      const updated: WorkerTokenPublic = {
        ...workerTokens[index]!,
        status: 'revoked',
        revokedAt: '2026-07-11T11:00:00.000Z',
      };
      workerTokens[index] = updated;
      return Promise.resolve(updated);
    },
    listPersonalContext(userId) {
      return Promise.resolve({ contexts: contextsByUser.get(userId) ?? [] });
    },
    createPersonalContext(userId, body) {
      const created: PersonalContextPublic = {
        id: `ctx-${++counter}`,
        userId,
        category: body.category,
        name: body.name,
        relationship: body.relationship ?? null,
        aiUsageAllowed: body.aiUsageAllowed ?? false,
        createdAt: '2026-07-11T10:00:00.000Z',
      };
      const list = contextsByUser.get(userId) ?? [];
      list.push(created);
      contextsByUser.set(userId, list);
      return Promise.resolve(created);
    },
    updatePersonalContext(userId, contextId, body) {
      const list = contextsByUser.get(userId) ?? [];
      const index = list.findIndex((c) => c.id === contextId);
      const updated: PersonalContextPublic = {
        ...list[index]!,
        category: body.category,
        name: body.name,
        relationship: body.relationship ?? null,
        aiUsageAllowed: body.aiUsageAllowed ?? false,
      };
      list[index] = updated;
      return Promise.resolve(updated);
    },
    deletePersonalContext(userId, contextId) {
      const list = contextsByUser.get(userId) ?? [];
      contextsByUser.set(
        userId,
        list.filter((c) => c.id !== contextId),
      );
      return Promise.resolve();
    },
    listPreferences() {
      return Promise.resolve({ preferences: [] });
    },
    resolveSuggestion() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
    },
    // Vraagmodus (T7.1) — apart gedekt in QuestionModePage-tests; hier stubs zodat de app tegen de
    // volledige `Api` compileert (de beheeromgeving-tests raken de vraagmodus niet).
    searchAac() {
      return Promise.resolve({ symbols: [] });
    },
    listQuestionUsers() {
      return Promise.resolve({ users: [] });
    },
    startQuestion() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
    },
    viewUserConversation() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
    },
    // Dashboard + conceptvoorstellen (T7.3) — apart gedekt in eigen tests; hier stubs zodat de app
    // tegen de volledige `Api` compileert.
    getDashboard() {
      return Promise.resolve({
        users: { total: 0, active: 0 },
        caregivers: { total: 0 },
        pendingProposals: 0,
        recentActivity: [],
      });
    },
    listAuditLogs() {
      return Promise.resolve({ entries: [] });
    },
    // Operatorconsole (T8.3) — eigen routetak met eigen test; hier stubs zodat de beheer-app
    // tegen de volledige `Api` compileert.
    listOperatorOrganizations() {
      return Promise.reject(new ApiRequestError(403, 'NOT_OPERATOR', 'niet in deze test'));
    },
    createOperatorOrganization() {
      return Promise.reject(new ApiRequestError(403, 'NOT_OPERATOR', 'niet in deze test'));
    },
    getOperatorOrganization() {
      return Promise.reject(new ApiRequestError(403, 'NOT_OPERATOR', 'niet in deze test'));
    },
    deactivateOperatorOrganization() {
      return Promise.reject(new ApiRequestError(403, 'NOT_OPERATOR', 'niet in deze test'));
    },
    activateOperatorOrganization() {
      return Promise.reject(new ApiRequestError(403, 'NOT_OPERATOR', 'niet in deze test'));
    },
    listConceptProposals() {
      return Promise.resolve({ proposals: [] });
    },
    approveConceptProposal() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
    },
    rejectConceptProposal() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
    },
    // Profielexport/-import (T8.1) — apart gedekt in ProfileTransfer-tests; hier stubs zodat de app
    // tegen de volledige `Api` compileert.
    exportProfile() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
    },
    listAacTopics() {
      return Promise.resolve({ topics: [] });
    },
    getAiStatus() {
      return Promise.resolve({
        mode: 'mock' as const,
        workerRequired: false,
        workersOnline: 0,
        lastSeenAt: null,
        active: false,
      });
    },
    importProfile() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
    },
  };
}

describe('beheeromgeving-app', () => {
  it('toont het loginscherm wanneer er geen sessie is', async () => {
    render(<App api={fakeApi()} />);
    expect(await screen.findByRole('button', { name: 'Inloggen' })).toBeTruthy();
  });

  it('toont een fout bij verkeerde inloggegevens', async () => {
    render(<App api={fakeApi()} />);
    await screen.findByRole('button', { name: 'Inloggen' });

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'fout@intento.local' } });
    fireEvent.change(screen.getByLabelText('Wachtwoord'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Inloggen' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Onjuiste e-mail of wachtwoord.',
    );
  });

  it('laat een nieuwe bezoeker via zelfaanmelding een omgeving aanmaken en logt meteen in', async () => {
    render(<App api={fakeApi()} />);
    await screen.findByRole('button', { name: 'Inloggen' });

    // Vanaf het loginscherm naar het aanmeldscherm.
    fireEvent.click(screen.getByRole('button', { name: 'Nieuwe omgeving aanmelden' }));
    const form = await screen.findByRole('form', { name: 'Aanmelden' });

    fireEvent.change(within(form).getByLabelText('Naam van de organisatie of familie'), {
      target: { value: 'Familie De Vries' },
    });
    fireEvent.change(within(form).getByLabelText('Jouw naam (beheerder)'), {
      target: { value: 'Kim' },
    });
    fireEvent.change(within(form).getByLabelText('E-mail'), {
      target: { value: 'admin@intento.local' },
    });
    fireEvent.change(within(form).getByLabelText('Wachtwoord (minstens 12 tekens)'), {
      target: { value: 'sterk-wachtwoord-123' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Omgeving aanmaken' }));

    // Direct ingelogd → beheeromgeving verschijnt zonder aparte login.
    expect(await screen.findByRole('heading', { name: 'Gebruikersbeheer' })).toBeTruthy();
  });

  it('laat een beheerder een gebruiker aanmaken, instellen en verwijderen', async () => {
    render(<App api={fakeApi({ loggedIn: true })} />);

    // Beheeromgeving is direct zichtbaar bij een bestaande sessie.
    expect(await screen.findByRole('heading', { name: 'Gebruikersbeheer' })).toBeTruthy();

    // Aanmaken.
    fireEvent.change(screen.getByLabelText('Naam van de gebruiker'), {
      target: { value: 'Sanne' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Toevoegen' }));
    expect(await screen.findByRole('button', { name: 'Sanne' })).toBeTruthy();

    // Aangemaakte gebruiker wordt geselecteerd → instellingenformulier verschijnt.
    const form = await screen.findByRole('form', { name: 'Instellingen voor Sanne' });
    // Alleen 2/4/6/8 als keuze; 4 is de standaard.
    const radios = within(form).getAllByRole('radio');
    expect(radios).toHaveLength(4);

    // Wijzig naar 6 opties en sla op.
    fireEvent.click(within(form).getByRole('radio', { name: '6' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Instellingen opslaan' }));
    expect((await within(form).findByRole('status')).textContent).toContain('Opgeslagen');

    // Verwijderen.
    fireEvent.click(screen.getByRole('button', { name: 'Gebruiker Sanne verwijderen' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sanne' })).toBeNull());
  });

  it('laat een beheerder een begeleider aan een gebruiker koppelen', async () => {
    const api = fakeApi({
      loggedIn: true,
      caregivers: [
        { accountId: 'cg-1', email: 'begeleider@intento.local', role: 'CAREGIVER', linked: false },
      ],
    });
    render(<App api={api} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    // Gebruiker aanmaken en selecteren.
    fireEvent.change(screen.getByLabelText('Naam van de gebruiker'), {
      target: { value: 'Sanne' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Toevoegen' }));
    await screen.findByRole('button', { name: 'Sanne' });

    // Begeleiderpaneel verschijnt met de begeleider, nog niet gekoppeld.
    const panel = await screen.findByRole('region', { name: 'Begeleiders voor Sanne' });
    const checkbox = within(panel).getByRole<HTMLInputElement>('checkbox', {
      name: 'begeleider@intento.local',
    });
    expect(checkbox.checked).toBe(false);

    // Koppelen: schakelaar aan → blijft aangevinkt (server bevestigt de nieuwe stand).
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(true));
  });

  it('laat een beheerder een begeleider-account aanmaken dat meteen koppelbaar is (T2.4)', async () => {
    render(<App api={fakeApi({ loggedIn: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    // Gebruiker aanmaken en selecteren; de koppelweergave is nog leeg en wijst naar het paneel.
    fireEvent.change(screen.getByLabelText('Naam van de gebruiker'), {
      target: { value: 'Sanne' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Toevoegen' }));
    await screen.findByRole('button', { name: 'Sanne' });
    const linkPanel = await screen.findByRole('region', { name: 'Begeleiders voor Sanne' });
    await waitFor(() =>
      expect(linkPanel.textContent).toContain('Nog geen begeleider-accounts in deze organisatie'),
    );

    // Begeleider aanmaken: het tijdelijke wachtwoord komt één keer in beeld.
    const createPanel = screen.getByRole('region', { name: 'Begeleider aanmaken' });
    fireEvent.change(within(createPanel).getByLabelText('Naam'), { target: { value: 'Sam' } });
    fireEvent.change(within(createPanel).getByLabelText('E-mailadres'), {
      target: { value: 'sam@intento.local' },
    });
    fireEvent.click(within(createPanel).getByRole('button', { name: 'Begeleider aanmaken' }));
    expect((await within(createPanel).findByRole('status')).textContent).toContain(
      'tijdelijk-wachtwoord-123',
    );

    // …en het account staat direct in de koppelweergave (T2.2) en is te koppelen.
    const refreshed = await screen.findByRole('region', { name: 'Begeleiders voor Sanne' });
    const checkbox = await within(refreshed).findByRole<HTMLInputElement>('checkbox', {
      name: 'sam@intento.local',
    });
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(true));
  });

  it('laat een beheerder een koppelcode voor een tablet genereren', async () => {
    render(<App api={fakeApi({ loggedIn: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    // Gebruiker aanmaken en selecteren.
    fireEvent.change(screen.getByLabelText('Naam van de gebruiker'), {
      target: { value: 'Sanne' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Toevoegen' }));
    await screen.findByRole('button', { name: 'Sanne' });

    // Koppelpaneel verschijnt; code genereren toont de code én het adres waar hij ingevoerd wordt (T9.2).
    const panel = await screen.findByRole('region', { name: 'Tablet koppelen voor Sanne' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Koppelcode genereren' }));
    const result = await within(panel).findByRole('status');
    expect(result.textContent).toContain('ABCD2345');
    expect(result.textContent).toContain('/tablet');
  });

  it('toont in de beheeromgeving de tab "Begeleiden" en kan daar een vraag stellen (T9.1)', async () => {
    render(<App api={fakeApi({ loggedIn: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    const nav = screen.getByRole('navigation', { name: 'Beheer' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Begeleiden' }));

    // Dezelfde vraagmodus-pagina als de begeleider ziet — de server liet ADMIN hier altijd al toe.
    expect(await screen.findByRole('heading', { name: 'Vraag stellen' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Beheer' })).toBeTruthy();
  });

  it('dwingt een account met een tijdelijk wachtwoord eerst naar het wachtwoordscherm (T2.6)', async () => {
    render(<App api={fakeApi({ loggedIn: true, mustChangePassword: true })} />);

    // Geen beheeromgeving: alleen het blokkerende scherm met de enige toegestane actie.
    await screen.findByRole('heading', { name: 'Kies eerst een eigen wachtwoord' });
    expect(screen.queryByRole('heading', { name: 'Gebruikersbeheer' })).toBeNull();

    const panel = screen.getByRole('region', { name: 'Wachtwoord wijzigen' });
    fireEvent.change(within(panel).getByLabelText('Huidig wachtwoord'), {
      target: { value: 'tijdelijk-wachtwoord-123' },
    });
    fireEvent.change(within(panel).getByLabelText('Nieuw wachtwoord'), {
      target: { value: 'mijn eigen sterke wachtwoord' },
    });
    fireEvent.change(within(panel).getByLabelText('Nieuw wachtwoord herhalen'), {
      target: { value: 'mijn eigen sterke wachtwoord' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Wachtwoord wijzigen' }));

    // Na de wissel valt de markering weg en staat de beheeromgeving open.
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });
  });

  it('toont de beheerder welke logins nog op een tijdelijk wachtwoord zitten (T2.6)', async () => {
    render(<App api={fakeApi({ loggedIn: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    // Alleen de beheerder zelf: geen markering op zijn regel (hij koos zijn eigen wachtwoord).
    const panel = await screen.findByRole('region', { name: 'Logins in deze organisatie' });
    const adminRow = await within(panel).findByRole('listitem');
    expect(adminRow.textContent).toContain('admin@intento.local');
    expect(adminRow.textContent).not.toContain('tijdelijk wachtwoord');

    // Begeleider aanmaken (T2.4) → verschijnt gemarkeerd in de lijst.
    const createPanel = screen.getByRole('region', { name: 'Begeleider aanmaken' });
    fireEvent.change(within(createPanel).getByLabelText('Naam'), { target: { value: 'Sam' } });
    fireEvent.change(within(createPanel).getByLabelText('E-mailadres'), {
      target: { value: 'sam@intento.local' },
    });
    fireEvent.click(within(createPanel).getByRole('button', { name: 'Begeleider aanmaken' }));

    const refreshed = await screen.findByRole('region', { name: 'Logins in deze organisatie' });
    await waitFor(() => expect(within(refreshed).getAllByRole('listitem')).toHaveLength(2));
    const caregiverRow = within(refreshed)
      .getAllByRole('listitem')
      .find((row) => row.textContent?.includes('sam@intento.local'));
    expect(caregiverRow?.textContent).toContain('tijdelijk wachtwoord');
    expect(within(refreshed).getByRole('status').textContent).toContain(
      '1 login zit nog op een tijdelijk wachtwoord',
    );
  });

  it('toont een verificatiebanner voor een onbevestigd account en verstuurt opnieuw (T1.4)', async () => {
    render(<App api={fakeApi({ loggedIn: true, emailVerified: false })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    // Banner zichtbaar met een "opnieuw versturen"-knop.
    const resend = await screen.findByRole('button', {
      name: 'Verificatiemail opnieuw versturen',
    });
    fireEvent.click(resend);

    // Na versturen een neutrale bevestiging (geen enumeratie).
    expect(await screen.findByText(/nieuwe verificatiemail verstuurd/i)).toBeTruthy();
  });

  it('geen verificatiebanner voor een bevestigd account', async () => {
    render(<App api={fakeApi({ loggedIn: true, emailVerified: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });
    expect(screen.queryByRole('button', { name: 'Verificatiemail opnieuw versturen' })).toBeNull();
  });

  it('laat een platformbeheerder een worker-token aanmaken en intrekken (T5.8)', async () => {
    render(<App api={fakeApi({ loggedIn: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    // Naar het worker-tokentabblad.
    fireEvent.click(screen.getByRole('button', { name: 'Worker-tokens' }));
    await screen.findByRole('heading', { name: 'Worker-tokens' });
    expect(await screen.findByText(/Nog geen worker-tokens/i)).toBeTruthy();

    // Token aanmaken → rauw token wordt één keer getoond.
    const form = screen.getByRole('form', { name: 'Worker-token aanmaken' });
    fireEvent.change(within(form).getByLabelText('Naam van het worker-token'), {
      target: { value: 'gpu-node-1' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Token aanmaken' }));

    const reveal = await screen.findByRole('status');
    expect(reveal.textContent).toContain('wrk_raw-');

    // Het token verschijnt in de lijst als actief.
    const list = screen.getByRole('region', { name: 'Worker-tokens' });
    expect(await within(list).findByText('gpu-node-1')).toBeTruthy();
    expect(within(list).getByText('Actief')).toBeTruthy();

    // Intrekken → status wordt Ingetrokken en de intrek-knop verdwijnt.
    fireEvent.click(
      within(list).getByRole('button', { name: 'Worker-token gpu-node-1 intrekken' }),
    );
    await waitFor(() => expect(within(list).getByText('Ingetrokken')).toBeTruthy());
    expect(
      within(list).queryByRole('button', { name: 'Worker-token gpu-node-1 intrekken' }),
    ).toBeNull();
  });

  it('toont een uitleg i.p.v. de lijst voor een niet-platform-beheerder (T5.8)', async () => {
    render(<App api={fakeApi({ loggedIn: true, workerTokensForbidden: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    fireEvent.click(screen.getByRole('button', { name: 'Worker-tokens' }));
    await screen.findByRole('heading', { name: 'Worker-tokens' });

    expect(await screen.findByText(/alleen door een platformbeheerder/i)).toBeTruthy();
    // Geen aanmaakformulier zichtbaar.
    expect(screen.queryByRole('form', { name: 'Worker-token aanmaken' })).toBeNull();
  });

  it('wisselt een token uit de e-maillink in via de verificatiepagina (T1.4)', async () => {
    render(
      <App
        api={fakeApi({ loggedIn: true, emailVerified: false })}
        initialVerificationToken="tok-123"
      />,
    );

    // Verificatiepagina toont succes en een doorgaan-knop.
    expect(await screen.findByText(/e-mailadres is bevestigd/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Doorgaan' }));

    // Terug in de beheeromgeving; het account geldt nu als geverifieerd (geen banner).
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Verificatiemail opnieuw versturen' }),
      ).toBeNull(),
    );
  });
});
