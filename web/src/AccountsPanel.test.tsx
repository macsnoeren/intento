import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AccountPublic, ResetAccountPasswordResponse } from '@intento/shared';
import { AccountsPanel } from './AccountsPanel.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor de accountlijst (T2.6) en het uitgeven van een nieuw tijdelijk wachtwoord (T2.7).
 * Draaien tegen een in-memory `Api`. De echte garanties (ADMIN-only, tenant-isolatie, sessies
 * intrekken, audit) zitten server-side (`server/src/routes/accounts.test.ts`); hier bewaken we dat
 * de beheerder de markering ziet, het wachtwoord één keer getoond krijgt, de actie pas ná
 * bevestiging vertrekt en het eigen account geen knop heeft.
 */

const admin: AccountPublic = {
  id: 'acc-admin',
  email: 'admin@intento.local',
  role: 'ADMIN',
  organizationId: 'org-1',
  name: 'Ada de Beheerder',
  emailVerified: true,
  mustChangePassword: false,
  isOperator: false,
};

const caregiver: AccountPublic = {
  id: 'acc-care',
  email: 'sam@intento.local',
  role: 'CAREGIVER',
  organizationId: 'org-1',
  name: 'Sam de Begeleider',
  emailVerified: false,
  mustChangePassword: false,
  isOperator: false,
};

function fakeApi(
  reset: (accountId: string) => Promise<ResetAccountPasswordResponse>,
  accounts: AccountPublic[] = [admin, caregiver],
): Api {
  return {
    listAccounts: () => Promise.resolve({ accounts }),
    resetAccountPassword: reset,
  } as unknown as Api;
}

const issued: ResetAccountPasswordResponse = {
  account: { ...caregiver, mustChangePassword: true },
  temporaryPassword: 'nieuw-tijdelijk-wachtwoord-456',
  revokedSessions: 2,
};

function renderPanel(api: Api) {
  render(<AccountsPanel api={api} refreshToken={0} currentAccountId={admin.id} />);
}

/** Wacht tot de lijst geladen is (de knop van de begeleider staat er dan). */
async function resetButton(): Promise<HTMLElement> {
  return await screen.findByRole('button', {
    name: `Nieuw tijdelijk wachtwoord voor ${caregiver.name}`,
  });
}

describe('AccountsPanel (T2.6/T2.7)', () => {
  it('toont de markering "tijdelijk wachtwoord" van een begeleider', async () => {
    renderPanel(fakeApi(vi.fn(), [admin, { ...caregiver, mustChangePassword: true }]));

    expect(await screen.findByText('tijdelijk wachtwoord')).toBeTruthy();
    expect(screen.getByText('1 login zit nog op een tijdelijk wachtwoord.')).toBeTruthy();
  });

  it('geeft pas ná bevestiging een nieuw tijdelijk wachtwoord uit en toont het één keer', async () => {
    const reset = vi.fn().mockResolvedValue(issued);
    renderPanel(fakeApi(reset));

    fireEvent.click(await resetButton());
    // Eén klik doet nog niets: de actie logt een collega overal uit.
    expect(reset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: `Ja, ${caregiver.name} uitloggen` }));

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(reset).toHaveBeenCalledWith(caregiver.id);
    expect(screen.getByText(issued.temporaryPassword)).toBeTruthy();
    // De beheerder ziet expliciet dat de lopende sessies eruit liggen.
    expect(screen.getByRole('status').textContent).toContain('2 openstaande sessies');
  });

  it('annuleert de bevestiging zonder iets uit te geven', async () => {
    const reset = vi.fn();
    renderPanel(fakeApi(reset));

    fireEvent.click(await resetButton());
    fireEvent.click(screen.getByRole('button', { name: 'Annuleren' }));

    expect(reset).not.toHaveBeenCalled();
    expect(await resetButton()).toBeTruthy();
  });

  it('geeft het eigen account geen knop (dat loopt via Wachtwoord wijzigen)', async () => {
    renderPanel(fakeApi(vi.fn()));

    await resetButton();
    expect(
      screen.queryByRole('button', { name: `Nieuw tijdelijk wachtwoord voor ${admin.name}` }),
    ).toBeNull();
    expect(screen.getByText('jouw login')).toBeTruthy();
  });

  it('toont de servermelding als het uitgeven mislukt', async () => {
    const reset = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(403, 'FORBIDDEN', 'Je hebt geen toegang.'));
    renderPanel(fakeApi(reset));

    fireEvent.click(await resetButton());
    fireEvent.click(screen.getByRole('button', { name: `Ja, ${caregiver.name} uitloggen` }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Je hebt geen toegang.'),
    );
    // Geen half wachtwoord in beeld bij een mislukte actie.
    expect(screen.queryByText(issued.temporaryPassword)).toBeNull();
  });
});
