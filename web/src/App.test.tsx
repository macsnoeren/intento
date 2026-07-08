import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  AuthResponse,
  CaregiverLink,
  CaregiverListResponse,
  CreateUserRequest,
  UpdateSettingsRequest,
  UserListResponse,
  UserPublic,
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
function fakeApi(options: { loggedIn?: boolean; caregivers?: CaregiverLink[] } = {}): Api {
  let session = options.loggedIn ?? false;
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
        ? Promise.resolve({ account: adminAccount })
        : Promise.reject(new ApiRequestError(401, 'NOT_AUTHENTICATED', 'Niet ingelogd.'));
    },
    login(email: string): Promise<AuthResponse> {
      if (email !== adminAccount.email) {
        return Promise.reject(
          new ApiRequestError(401, 'INVALID_CREDENTIALS', 'Onjuiste e-mail of wachtwoord.'),
        );
      }
      session = true;
      return Promise.resolve({ account: adminAccount });
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
    linkCaregiver(userId: string, accountId: string, linked: boolean): Promise<CaregiverListResponse> {
      const set = linksByUser.get(userId) ?? new Set<string>();
      if (linked) set.add(accountId);
      else set.delete(accountId);
      linksByUser.set(userId, set);
      return Promise.resolve({ caregivers: caregiversFor(userId) });
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
});
