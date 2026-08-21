import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChangePasswordRequest, ChangePasswordResponse } from '@intento/shared';
import { ChangePasswordPanel } from './ChangePasswordPanel.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor het wijzigen van het eigen wachtwoord (T2.5). Draaien tegen een in-memory `Api`.
 * De echte garanties (her-authenticatie, alleen het eigen account, intrekken van overige sessies)
 * zitten server-side (`server/src/auth/change-password.test.ts`); hier bewaken we dat de UI het
 * juiste verstuurt, de velden leegmaakt en fouten netjes toont.
 */

/** Nep-`Api` met alléén `changePassword`; het paneel raakt geen ander endpoint aan. */
function fakeApi(change: (body: ChangePasswordRequest) => Promise<ChangePasswordResponse>): Api {
  return { changePassword: change } as unknown as Api;
}

function fill(
  current = 'tijdelijk-wachtwoord-123',
  next = 'mijn nieuwe wachtwoord',
  repeat = next,
) {
  fireEvent.change(screen.getByLabelText('Huidig wachtwoord'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('Nieuw wachtwoord'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Nieuw wachtwoord herhalen'), {
    target: { value: repeat },
  });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Wachtwoord wijzigen' }));
}

describe('ChangePasswordPanel (T2.5)', () => {
  it('verstuurt huidig + nieuw wachtwoord en maakt de velden daarna leeg', async () => {
    const change = vi.fn().mockResolvedValue({ revokedSessions: 0 });
    render(<ChangePasswordPanel api={fakeApi(change)} />);

    fill();
    submit();

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(change).toHaveBeenCalledWith({
      currentPassword: 'tijdelijk-wachtwoord-123',
      newPassword: 'mijn nieuwe wachtwoord',
    });
    // Geen wachtwoord dat op een onbeheerd scherm blijft staan.
    expect(screen.getByLabelText<HTMLInputElement>('Huidig wachtwoord').value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>('Nieuw wachtwoord').value).toBe('');
  });

  it('meldt hoeveel andere apparaten zijn uitgelogd', async () => {
    const change = vi.fn().mockResolvedValue({ revokedSessions: 2 });
    render(<ChangePasswordPanel api={fakeApi(change)} />);

    fill();
    submit();

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toContain('2');
  });

  it('verstuurt niets als de herhaling niet gelijk is', () => {
    const change = vi.fn().mockResolvedValue({ revokedSessions: 0 });
    render(<ChangePasswordPanel api={fakeApi(change)} />);

    fill('huidig wachtwoord', 'mijn nieuwe wachtwoord', 'mijn niewe wachtwoord');
    submit();

    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Wachtwoord wijzigen' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('toont de servermelding bij een fout huidig wachtwoord', async () => {
    const change = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError(401, 'INVALID_CURRENT_PASSWORD', 'Het huidige wachtwoord klopt niet.'),
      );
    render(<ChangePasswordPanel api={fakeApi(change)} />);

    fill('fout wachtwoord');
    submit();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Het huidige wachtwoord klopt niet.');
    // Bij een fout blijft het formulier ingevuld zodat de gebruiker het kan corrigeren.
    expect(screen.getByLabelText<HTMLInputElement>('Nieuw wachtwoord').value).toBe(
      'mijn nieuwe wachtwoord',
    );
  });
});
