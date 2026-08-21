import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  AccountPublic,
  OperatorOrganization,
  OperatorOrganizationDetail,
} from '@intento/shared';
import { OperatorConsole } from './OperatorConsole.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor de platform-operatorconsole (T8.3). Draaien tegen een in-memory `Api`; de echte
 * grens (wie mag erbij, wat komt eruit) is met de server-tests gedekt. Hier gaat het om het gedrag
 * van het scherm: ziet een operator alle omgevingen, kan hij er één stoppen en hervatten, en — even
 * belangrijk — krijgt een niet-operator een nette uitleg in plaats van een lege lijst.
 */

const operatorAccount: AccountPublic = {
  id: 'acc-ops',
  email: 'ops@intento.local',
  role: 'ADMIN',
  organizationId: 'org-platform',
  name: null,
  emailVerified: true,
  mustChangePassword: false,
  isOperator: true,
};

function organization(overrides: Partial<OperatorOrganization> = {}): OperatorOrganization {
  return {
    id: 'org-1',
    name: 'Familie De Vries',
    type: 'family',
    active: true,
    isPlatform: false,
    userCount: 2,
    accountCount: 1,
    createdAt: '2026-07-01T09:00:00.000Z',
    ...overrides,
  };
}

/** Bouwt een `Api` waarin alleen de meegegeven calls bestaan; de rest faalt luid. */
function fakeApi(overrides: Partial<Api>): Api {
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return { ...base, me: () => Promise.resolve({ account: operatorAccount }), ...overrides };
}

describe('operatorconsole', () => {
  it('toont omgevingen van alle tenants met status en aantallen', async () => {
    const api = fakeApi({
      listOperatorOrganizations: () =>
        Promise.resolve({
          organizations: [
            organization(),
            organization({
              id: 'org-2',
              name: 'Zorggroep Noord',
              type: 'care',
              active: false,
              userCount: 12,
            }),
          ],
        }),
    });

    render(<OperatorConsole api={api} />);

    expect(await screen.findByText('Familie De Vries')).toBeTruthy();
    expect(screen.getByText('Zorggroep Noord')).toBeTruthy();
    expect(screen.getByText('Actief')).toBeTruthy();
    expect(screen.getByText('Gedeactiveerd')).toBeTruthy();
    // Aantallen per omgeving, zodat een operator de omvang ziet zonder de mensen te zien.
    expect(screen.getByText(/Familie · 2 gebruikers/)).toBeTruthy();
    expect(screen.getByText(/Zorginstelling · 12 gebruikers/)).toBeTruthy();
  });

  it('deactiveert een omgeving en toont daarna de nieuwe status', async () => {
    let active = true;
    const deactivate = vi.fn(() => {
      active = false;
      return Promise.resolve(organization({ active: false }));
    });
    const api = fakeApi({
      listOperatorOrganizations: () =>
        Promise.resolve({ organizations: [organization({ active })] }),
      deactivateOperatorOrganization: deactivate,
    });

    render(<OperatorConsole api={api} />);
    await screen.findByText('Familie De Vries');

    fireEvent.click(screen.getByRole('button', { name: 'Deactiveren' }));

    await waitFor(() => expect(deactivate).toHaveBeenCalledWith('org-1'));
    expect(await screen.findByText('Gedeactiveerd')).toBeTruthy();
    // De knop draait mee: een gestopte omgeving kun je weer aanzetten.
    expect(screen.getByRole('button', { name: 'Activeren' })).toBeTruthy();
  });

  it('biedt geen deactiveerknop voor de platformorganisatie', async () => {
    const api = fakeApi({
      listOperatorOrganizations: () =>
        Promise.resolve({
          organizations: [
            organization({ id: 'org-platform', name: 'Platformomgeving', isPlatform: true }),
          ],
        }),
    });

    render(<OperatorConsole api={api} />);
    await screen.findByText('Platformomgeving');

    expect(screen.queryByRole('button', { name: 'Deactiveren' })).toBeNull();
  });

  it('maakt een omgeving aan en ververst de lijst', async () => {
    const created: OperatorOrganization[] = [];
    const api = fakeApi({
      listOperatorOrganizations: () => Promise.resolve({ organizations: [...created] }),
      createOperatorOrganization: (body) => {
        const fresh = organization({ id: 'org-new', name: body.name, type: body.type });
        created.push(fresh);
        return Promise.resolve(fresh);
      },
    });

    render(<OperatorConsole api={api} />);
    await screen.findByRole('button', { name: 'Aanmaken' });

    fireEvent.change(screen.getByLabelText('Naam'), { target: { value: 'Zorggroep Zuid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aanmaken' }));

    expect(await screen.findByText('Zorggroep Zuid')).toBeTruthy();
  });

  it('toont in het detail logins en gebruikers zonder namen', async () => {
    const detail: OperatorOrganizationDetail = {
      organization: organization(),
      accounts: [
        {
          id: 'acc-1',
          email: 'admin@familie.local',
          name: null,
          role: 'ADMIN',
          emailVerified: true,
          mustChangePassword: false,
          isOperator: false,
          createdAt: '2026-07-01T09:00:00.000Z',
        },
      ],
      users: [{ id: 'user-1', active: true, createdAt: '2026-07-02T09:00:00.000Z' }],
    };
    const api = fakeApi({
      listOperatorOrganizations: () => Promise.resolve({ organizations: [organization()] }),
      getOperatorOrganization: () => Promise.resolve(detail),
    });

    render(<OperatorConsole api={api} />);
    await screen.findByText('Familie De Vries');

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(await screen.findByText('admin@familie.local')).toBeTruthy();
    expect(screen.getByText('Logins (1)')).toBeTruthy();
    // De gebruiker verschijnt als id: namen verlaten hun eigen omgeving niet.
    expect(screen.getByText('user-1')).toBeTruthy();
  });

  it('legt een niet-operator uit dat hij hier niets te zoeken heeft', async () => {
    const api = fakeApi({
      me: () => Promise.resolve({ account: { ...operatorAccount, isOperator: false } }),
      listOperatorOrganizations: () =>
        Promise.reject(new ApiRequestError(403, 'NOT_OPERATOR', 'Geen toegang.')),
    });

    render(<OperatorConsole api={api} />);

    expect(await screen.findByText(/geen platform-operatorrechten/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aanmaken' })).toBeNull();
  });

  it('toont het loginscherm zonder sessie', async () => {
    const api = fakeApi({
      me: () => Promise.reject(new ApiRequestError(401, 'NOT_AUTHENTICATED', 'Niet ingelogd.')),
    });

    render(<OperatorConsole api={api} />);

    expect(await screen.findByRole('button', { name: 'Inloggen' })).toBeTruthy();
  });
});
