import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  AuthResponse,
  CaregiverLink,
  CaregiverListResponse,
  CreateUserRequest,
  DeviceCodeResponse,
  ResendVerificationResponse,
  UpdateSettingsRequest,
  UserListResponse,
  UserPublic,
  VerifyEmailResponse,
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
  emailVerified: true,
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
    },
  };
}

/** Bouwt een stateful nep-backend; `loggedIn` bepaalt of er al een sessie is. */
function fakeApi(
  options: { loggedIn?: boolean; caregivers?: CaregiverLink[]; emailVerified?: boolean } = {},
): Api {
  let session = options.loggedIn ?? false;
  let emailVerified = options.emailVerified ?? true;
  const account = (): typeof adminAccount => ({ ...adminAccount, emailVerified });
  const users: UserPublic[] = [];
  let counter = 0;
  // Koppelingen per gebruiker; de begeleiderlijst zelf is organisatiebreed (uit `options`).
  const caregiverSeed = options.caregivers ?? [];
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
      caregivers: [{ accountId: 'cg-1', email: 'begeleider@intento.local', linked: false }],
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

  it('laat een beheerder een koppelcode voor een tablet genereren', async () => {
    render(<App api={fakeApi({ loggedIn: true })} />);
    await screen.findByRole('heading', { name: 'Gebruikersbeheer' });

    // Gebruiker aanmaken en selecteren.
    fireEvent.change(screen.getByLabelText('Naam van de gebruiker'), {
      target: { value: 'Sanne' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Toevoegen' }));
    await screen.findByRole('button', { name: 'Sanne' });

    // Koppelpaneel verschijnt; code genereren toont de code.
    const panel = await screen.findByRole('region', { name: 'Tablet koppelen voor Sanne' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Koppelcode genereren' }));
    expect((await within(panel).findByRole('status')).textContent).toContain('ABCD2345');
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
