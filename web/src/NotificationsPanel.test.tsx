import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountNotifications, AccountNotificationsUpdate } from '@intento/shared';
import { NotificationsPanel } from './NotificationsPanel.tsx';
import { NavBadgesProvider } from './NavBadges.tsx';
import { AdminNav } from './AdminNav.tsx';
import { ApiRequestError, type Api } from './api.ts';

/** Meldingen en de teller in het menu (N9.3, INTENTO-NEW-DESIGN §17). */

function fakeApi(open = 3): { api: Api; saved: AccountNotificationsUpdate[]; counts: number[] } {
  const saved: AccountNotificationsUpdate[] = [];
  const counts: number[] = [];
  let current: AccountNotifications = { notifyGapsByEmail: false, copySentMessages: false };
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return {
    saved,
    counts,
    api: {
      ...base,
      getAccountNotifications: () => Promise.resolve(current),
      updateAccountNotifications(body) {
        saved.push(body);
        current = { ...current, ...body };
        return Promise.resolve(current);
      },
      getVocabularyGapCount() {
        counts.push(open);
        return Promise.resolve({ open });
      },
    },
  };
}

describe('meldingen', () => {
  it('e-mail bij een nieuw ontbrekend woord: standaard uit, aan te zetten', async () => {
    const { api, saved } = fakeApi();
    render(<NotificationsPanel api={api} />);
    const box = screen.getByLabelText<HTMLInputElement>('E-mail bij een nieuw ontbrekend woord');
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(true));
    expect(saved).toEqual([{ notifyGapsByEmail: true }]);
  });

  it('kopie van verstuurde berichten: los aan te zetten, de andere blijft staan', async () => {
    const { api, saved } = fakeApi();
    render(<NotificationsPanel api={api} />);
    const copy = screen.getByLabelText<HTMLInputElement>('Kopie van verstuurde berichten');
    await waitFor(() => expect(copy.disabled).toBe(false));
    fireEvent.click(copy);
    await waitFor(() => expect(copy.checked).toBe(true));
    expect(saved).toEqual([{ copySentMessages: true }]);
    expect(
      screen.getByLabelText<HTMLInputElement>('E-mail bij een nieuw ontbrekend woord').checked,
    ).toBe(false);
  });
});

describe('teller in het menu', () => {
  it('toont het aantal open ontbrekende woorden bij het menu-item', async () => {
    const { api } = fakeApi(3);
    render(
      <NavBadgesProvider api={api} view="users">
        <AdminNav active="users" onNavigate={() => {}} />
      </NavBadgesProvider>,
    );
    const item = await screen.findByRole('button', { name: 'Ontbrekende woorden, 3 open' });
    expect(item.querySelector('.app-nav__badge')?.textContent).toBe('3');
  });

  it('geen teller bij nul, en ook niet als ophalen mislukt', async () => {
    const { api, counts } = fakeApi(0);
    const { rerender } = render(
      <NavBadgesProvider api={api} view="users">
        <AdminNav active="users" onNavigate={() => {}} />
      </NavBadgesProvider>,
    );
    await waitFor(() => expect(counts).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Ontbrekende woorden' })).toBeTruthy();

    const failing = { ...api, getVocabularyGapCount: () => Promise.reject(new Error('weg')) };
    rerender(
      <NavBadgesProvider api={failing} view="vocabulary">
        <AdminNav active="vocabulary" onNavigate={() => {}} />
      </NavBadgesProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Ontbrekende woorden' })).toBeTruthy();
  });
});
