import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  AccountListResponse,
  AccountPublic,
  AuthResponse,
  CaregiverLink,
  ChangePasswordResponse,
  CaregiverListResponse,
  CreateCaregiverRequest,
  CreateCaregiverResponse,
  CreateUserRequest,
  DeviceCodeResponse,
  ResendVerificationResponse,
  ResetAccountPasswordResponse,
  UpdateSettingsRequest,
  UserListResponse,
  UserPublic,
  VerifyEmailResponse,
} from '@intento/shared';
import { App } from './App.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor de beheeromgeving. Draaien tegen een in-memory `Api`, zodat de
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
      showText: true,
      speechEnabled: false,
      speechVoice: 'nl_NL-pim-medium',
    },
  };
}

/** Bouwt een stateful nep-backend; `loggedIn` bepaalt of er al een sessie is. */
function fakeApi(
  options: {
    loggedIn?: boolean;
    caregivers?: CaregiverLink[];
    emailVerified?: boolean;
    /** Simuleer een account dat nog op zijn tijdelijke wachtwoord uit T2.4 zit. */
    mustChangePassword?: boolean;
    /** De rol van het ingelogde account; standaard beheerder. */
    role?: AccountPublic['role'];
  } = {},
): Api {
  let session = options.loggedIn ?? false;
  let emailVerified = options.emailVerified ?? true;
  let mustChangePassword = options.mustChangePassword ?? false;
  const account = (): AccountPublic => ({
    ...adminAccount,
    role: options.role ?? adminAccount.role,
    emailVerified,
    mustChangePassword,
  });
  const users: UserPublic[] = [];
  let counter = 0;
  // Koppelingen per gebruiker; de begeleiderlijst zelf is organisatiebreed (uit `options`).
  const caregiverSeed = options.caregivers ?? [];
  let caregiverCounter = caregiverSeed.length;
  const linksByUser = new Map<string, Set<string>>();

  function caregiversFor(userId: string): CaregiverLink[] {
    const linked = linksByUser.get(userId) ?? new Set<string>();
    return caregiverSeed.map((c) => ({ ...c, linked: linked.has(c.accountId) }));
  }

  return {
    speechPreview(): Promise<Blob> {
      // Beluisteren doet deze nep-API niet; de knop wordt in SettingsForm.test.tsx apart getest.
      return Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }));
    },
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
      // Zelfaanmelding maakt een nieuwe omgeving + admin en logt meteen in.
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
      // Zoals de server: een geslaagde wijziging heft de tijdelijk-wachtwoord-markering op.
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
      // Server-gedrag nagebootst: rol vast op CAREGIVER, eigen organisatie, tijdelijk
      // wachtwoord uit de backend. Het account komt meteen in de organisatiebrede begeleiderlijst.
      const account = {
        id: `cg-${++caregiverCounter}`,
        email: body.email,
        role: 'CAREGIVER' as const,
        organizationId: adminAccount.organizationId,
        name: body.name,
        emailVerified: false,
        // Een vers account draait nog op het tijdelijke wachtwoord dat de server teruggaf.
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
      // Server-gedrag nagebootst: nieuw server-gegenereerd wachtwoord, account weer
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
    // Dashboard + conceptvoorstellen — apart gedekt in eigen tests; hier stubs zodat de app
    // tegen de volledige `Api` compileert.
    getDashboard() {
      return Promise.resolve({
        users: { total: 0, active: 0 },
        caregivers: { total: 0 },
      });
    },
    listAuditLogs() {
      return Promise.resolve({ entries: [] });
    },
    // Operatorconsole — eigen routetak met eigen test; hier stubs zodat de beheer-app
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
    // Profielexport/-import — apart gedekt in ProfileTransfer-tests; hier stubs zodat de app
    // tegen de volledige `Api` compileert.
    exportProfile() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
    },
    importProfile() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
    },
  };
}

/**
 * Maakt via de gebruikersdialoog een gebruiker aan. De app opent daarna zijn eigen scherm,
 * want een verse gebruiker heeft nog een communicatieprofiel nodig.
 */
async function createUser(name: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Gebruiker toevoegen' }));
  const dialog = await screen.findByRole('dialog', { name: 'Gebruiker toevoegen' });
  fireEvent.change(within(dialog).getByLabelText('Naam van de gebruiker'), {
    target: { value: name },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Toevoegen' }));
  await screen.findByRole('heading', { level: 1, name });
}

/** Opent een onderdeel op het scherm van één gebruiker (T17.4: keuzebalk in plaats van één raster). */
function openUserTab(label: string): void {
  fireEvent.click(screen.getByRole('tab', { name: label }));
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

    // Aanmaken via de dialoog; de app opent meteen het scherm van de nieuwe gebruiker.
    await createUser('Sanne');

    // Op dat scherm staat het instellingenformulier, zonder de oude AI-instellingen (N0.3).
    const form = await screen.findByRole('form', { name: 'Instellingen voor Sanne' });
    expect(within(form).queryByRole('radio', { name: /^[2468]$/ })).toBeNull();
    expect(within(form).queryByText(/AI leert/)).toBeNull();
    expect(within(form).queryByText(/Ondersteuningsmodus/)).toBeNull();

    // Tekst tonen uitzetten en opslaan.
    fireEvent.click(within(form).getByRole('checkbox', { name: /Tekst tonen/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Instellingen opslaan' }));
    expect((await within(form).findByRole('status')).textContent).toContain('Opgeslagen');

    // Verwijderen staat apart, onder "Profiel & verwijderen"; daarna zijn we terug op het
    // overzicht en is de regel weg.
    openUserTab('Profiel & verwijderen');
    fireEvent.click(screen.getByRole('button', { name: 'Gebruiker Sanne verwijderen' }));
    await screen.findByRole('heading', { level: 1, name: 'Gebruikersbeheer' });
    await waitFor(() => expect(screen.queryByText('Sanne')).toBeNull());
  });

  it('opent vanuit het overzicht het scherm van één gebruiker en gaat terug', async () => {
    render(<App api={fakeApi({ loggedIn: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });
    await createUser('Sanne');

    // Terug naar het overzicht: de regel staat er met wat je zonder openen wilt weten.
    fireEvent.click(screen.getByRole('button', { name: 'Alle gebruikers' }));
    const list = await screen.findByRole('region', { name: 'Gebruikers' });
    const row = within(list).getByRole('button', { name: /Sanne/ });
    expect(row.textContent).toContain('Voorlezen uit');

    // En vanaf die regel weer naar zijn eigen scherm: een keuzebalk met zijn onderdelen, en
    // "Instellingen" staat open.
    fireEvent.click(row);
    await screen.findByRole('heading', { level: 1, name: 'Sanne' });
    expect(screen.getByRole('form', { name: 'Instellingen voor Sanne' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Instellingen' }).getAttribute('aria-selected')).toBe(
      'true',
    );

    // Eén onderdeel tegelijk: naar "Tablet" haalt de instellingen uit beeld.
    openUserTab('Tablet');
    expect(await screen.findByRole('region', { name: 'Tablet koppelen voor Sanne' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Instellingen voor Sanne' })).toBeNull();

    // De oude onderdelen persoonlijke context en voorkeuren zijn weg (N0.3).
    expect(screen.queryByRole('tab', { name: 'Persoonlijke context' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Voorkeuren' })).toBeNull();

    // De formulieren om iemand toe te voegen staan hier niet meer tussen.
    expect(screen.queryByRole('region', { name: 'Begeleider aanmaken' })).toBeNull();
  });

  it('laat de focus in het naamveld staan terwijl je typt', async () => {
    render(<App api={fakeApi({ loggedIn: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    fireEvent.click(screen.getByRole('button', { name: 'Gebruiker toevoegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gebruiker toevoegen' });
    const input = within(dialog).getByLabelText<HTMLInputElement>('Naam van de gebruiker');
    input.focus();

    // Letter voor letter, zoals iemand typt. De waarde staat in de paginastate, dus de hele pagina
    // tekent hertekent bij elke aanslag — dat mag de focus niet uit het veld halen.
    for (const value of ['S', 'Sa', 'San', 'Sann', 'Sanne']) {
      fireEvent.change(input, { target: { value } });
      expect(document.activeElement).toBe(input);
    }
    expect(input.value).toBe('Sanne');
  });

  it('sluit de dialoog "Gebruiker toevoegen" met Escape zonder aan te maken', async () => {
    render(<App api={fakeApi({ loggedIn: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    fireEvent.click(screen.getByRole('button', { name: 'Gebruiker toevoegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gebruiker toevoegen' });
    fireEvent.change(within(dialog).getByLabelText('Naam van de gebruiker'), {
      target: { value: 'Per ongeluk' },
    });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Per ongeluk')).toBeNull();
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

    await createUser('Sanne');

    // Begeleiders zijn een eigen onderdeel van zijn scherm; de begeleider staat er nog
    // ongekoppeld in.
    openUserTab('Begeleiders');
    const panel = await screen.findByRole('region', { name: 'Begeleiders voor Sanne' });
    const checkbox = within(panel).getByRole<HTMLInputElement>('checkbox', {
      name: 'begeleider@intento.local',
    });
    expect(checkbox.checked).toBe(false);

    // Koppelen: schakelaar aan → blijft aangevinkt (server bevestigt de nieuwe stand).
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(true));
  });

  it('laat een beheerder een begeleider-account aanmaken dat meteen koppelbaar is', async () => {
    render(<App api={fakeApi({ loggedIn: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    // Gebruiker aanmaken; de koppelweergave op zijn scherm is nog leeg.
    await createUser('Sanne');
    openUserTab('Begeleiders');
    const linkPanel = await screen.findByRole('region', { name: 'Begeleiders voor Sanne' });
    await waitFor(() =>
      expect(linkPanel.textContent).toContain('Nog geen begeleider-accounts in deze organisatie'),
    );

    // Begeleiders maak je aan op het overzicht, onder "Logins". Het tijdelijke wachtwoord
    // komt daar één keer in beeld.
    fireEvent.click(screen.getByRole('button', { name: 'Alle gebruikers' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Logins' }));
    fireEvent.click(screen.getByRole('button', { name: 'Begeleider aanmaken' }));
    const createPanel = await screen.findByRole('region', { name: 'Begeleider aanmaken' });
    fireEvent.change(within(createPanel).getByLabelText('Naam'), { target: { value: 'Sam' } });
    fireEvent.change(within(createPanel).getByLabelText('E-mailadres'), {
      target: { value: 'sam@intento.local' },
    });
    fireEvent.click(within(createPanel).getByRole('button', { name: 'Begeleider aanmaken' }));
    expect((await within(createPanel).findByRole('status')).textContent).toContain(
      'tijdelijk-wachtwoord-123',
    );

    // …en het account is meteen aan de gebruiker te koppelen.
    fireEvent.click(screen.getByRole('button', { name: 'Sluiten' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Gebruikers' }));
    fireEvent.click(await screen.findByRole('button', { name: /Sanne/ }));
    openUserTab('Begeleiders');
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

    await createUser('Sanne');

    // Het koppelpaneel staat onder "Tablet"; code genereren toont de code én het adres waar hij
    // ingevoerd wordt.
    openUserTab('Tablet');
    const panel = await screen.findByRole('region', { name: 'Tablet koppelen voor Sanne' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Koppelcode genereren' }));
    const result = await within(panel).findByRole('status');
    expect(result.textContent).toContain('ABCD2345');
    expect(result.textContent).toContain('/tablet');
  });

  it('geeft een begeleider een menu met zijn eigen account erin', async () => {
    render(<App api={fakeApi({ loggedIn: true, role: 'CAREGIVER' })} />);

    // De vraagmodus is vervallen (N0.3); een begeleider komt binnen op zijn account.
    expect(await screen.findByRole('heading', { name: 'Mijn account' })).toBeTruthy();

    // Zijn menu is kort — geen organisatiebeheer.
    const nav = screen.getByRole('navigation', { name: 'Beheer' });
    expect(within(nav).queryByRole('button', { name: 'Gebruikers' })).toBeNull();
    expect(within(nav).getByRole('button', { name: 'Mijn account' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Wachtwoord wijzigen' })).toBeTruthy();
  });

  it('dwingt een account met een tijdelijk wachtwoord eerst naar het wachtwoordscherm', async () => {
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

  it('toont de beheerder welke logins nog op een tijdelijk wachtwoord zitten', async () => {
    render(<App api={fakeApi({ loggedIn: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    // De loginlijst zit achter het tabblad "Logins".
    fireEvent.click(screen.getByRole('tab', { name: 'Logins' }));

    // Alleen de beheerder zelf: geen markering op zijn regel (hij koos zijn eigen wachtwoord).
    const panel = await screen.findByRole('region', { name: 'Logins in deze organisatie' });
    const adminRow = await within(panel).findByRole('listitem');
    expect(adminRow.textContent).toContain('admin@intento.local');
    expect(adminRow.textContent).not.toContain('tijdelijk wachtwoord');

    // Begeleider aanmaken → verschijnt gemarkeerd in de lijst.
    fireEvent.click(screen.getByRole('button', { name: 'Begeleider aanmaken' }));
    const createPanel = await screen.findByRole('region', { name: 'Begeleider aanmaken' });
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

  it('toont een verificatiebanner voor een onbevestigd account en verstuurt opnieuw', async () => {
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

  it('wisselt een token uit de e-maillink in via de verificatiepagina', async () => {
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
