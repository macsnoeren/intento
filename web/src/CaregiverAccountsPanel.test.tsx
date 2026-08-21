import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CreateCaregiverRequest, CreateCaregiverResponse } from '@intento/shared';
import { CaregiverAccountsPanel } from './CaregiverAccountsPanel.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor het aanmaken van begeleider-accounts (T2.4). Draaien tegen een in-memory `Api`:
 * de beheerder vult naam + e-mail in, het tijdelijke wachtwoord komt één keer in beeld, en een
 * geweigerd e-mailadres levert een nette (niet-lekkende) melding. De rol/tenant-garanties zitten
 * server-side (`server/src/routes/accounts.test.ts`) — de UI stuurt bewust géén rol mee.
 */

/**
 * Nep-`Api` met alléén `createCaregiverAccount` ingevuld. Het paneel raakt geen ander endpoint aan,
 * dus de cast houdt de test kort in plaats van de volledige `Api` na te bouwen.
 */
function fakeApi(create: (body: CreateCaregiverRequest) => Promise<CreateCaregiverResponse>): Api {
  return { createCaregiverAccount: create } as unknown as Api;
}

function response(overrides: Partial<CreateCaregiverResponse['account']> = {}) {
  return {
    account: {
      id: 'acc-2',
      email: 'sam@intento.local',
      role: 'CAREGIVER' as const,
      organizationId: 'org-1',
      name: 'Sam',
      emailVerified: false,
      mustChangePassword: true,
      ...overrides,
    },
    temporaryPassword: 'tijdelijk-wachtwoord-123',
  };
}

function fillAndSubmit(name = 'Sam', email = 'sam@intento.local'): void {
  fireEvent.change(screen.getByLabelText('Naam'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('E-mailadres'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Begeleider aanmaken' }));
}

describe('CaregiverAccountsPanel (T2.4)', () => {
  it('maakt een begeleider aan en toont het tijdelijke wachtwoord één keer', async () => {
    const create = vi.fn().mockResolvedValue(response());
    const onCreated = vi.fn();
    render(<CaregiverAccountsPanel api={fakeApi(create)} onCreated={onCreated} />);

    fillAndSubmit();

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    // De UI stuurt alléén naam + e-mail; rol en organisatie bepaalt de server.
    expect(create).toHaveBeenCalledWith({ name: 'Sam', email: 'sam@intento.local' });
    expect(screen.getByRole('status').textContent).toContain('tijdelijk-wachtwoord-123');
    // De beheeromgeving ververst hierop de koppelweergave (T2.2).
    expect(onCreated).toHaveBeenCalledTimes(1);
    // Het formulier is leeg voor een volgende begeleider.
    expect(screen.getByLabelText<HTMLInputElement>('Naam').value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>('E-mailadres').value).toBe('');
  });

  it('toont de servermelding bij een geweigerd e-mailadres en verklapt niets', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError(
          409,
          'ACCOUNT_CREATE_FAILED',
          'Dit account kon niet worden aangemaakt. Controleer het e-mailadres of gebruik een ander adres.',
        ),
      );
    const onCreated = vi.fn();
    render(<CaregiverAccountsPanel api={fakeApi(create)} onCreated={onCreated} />);

    fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('kon niet worden aangemaakt');
    expect(alert.textContent).not.toContain('bestaat');
    expect(screen.queryByRole('status')).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('verwijst naar de koppelstap, want een begeleider ziet pas iets ná koppelen', () => {
    render(
      <CaregiverAccountsPanel
        api={fakeApi(() => Promise.reject(new Error()))}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: 'Begeleider aanmaken' }).textContent).toContain(
      'Gekoppelde begeleiders',
    );
  });
});
