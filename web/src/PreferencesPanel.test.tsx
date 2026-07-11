import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PreferencePublic, PreferenceSuggestionAction } from '@intento/shared';
import { PreferencesPanel } from './PreferencesPanel.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor de voorkeuren/suggestie-beheerkant (T6.3, DESIGN §3.8). Draaien tegen een in-memory
 * `Api`: de begeleider ziet geleerde voorkeuren en handelt een openstaande suggestie af
 * (accepteren/aanpassen/weigeren). Het leren zelf en de AI-invloed zijn server-side gedekt.
 */

function pref(overrides: Partial<PreferencePublic> = {}): PreferencePublic {
  return {
    id: 'pref-1',
    userId: 'u-1',
    concept: 'walking',
    label: 'Wandelen',
    confidence: 0.6,
    count: 3,
    suggestionStatus: 'pending',
    suggested: true,
    createdAt: '2026-07-12T10:00:00.000Z',
    ...overrides,
  };
}

/** Stateful nep-backend met alléén de voorkeuren-endpoints ingevuld; de rest werpt. */
function fakeApi(initial: PreferencePublic[]): {
  api: Api;
  calls: { userId: string; prefId: string; body: PreferenceSuggestionAction }[];
} {
  const store = [...initial];
  const calls: { userId: string; prefId: string; body: PreferenceSuggestionAction }[] = [];
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));

  const prefApi: Pick<Api, 'listPreferences' | 'resolveSuggestion'> = {
    listPreferences() {
      return Promise.resolve({ preferences: [...store] });
    },
    resolveSuggestion(userId, prefId, body) {
      calls.push({ userId, prefId, body });
      const index = store.findIndex((p) => p.id === prefId);
      const status =
        body.action === 'reject' ? ('dismissed' as const) : ('accepted' as const);
      const updated: PreferencePublic = {
        ...store[index]!,
        suggestionStatus: status,
        suggested: false,
      };
      store[index] = updated;
      return Promise.resolve(updated);
    },
  };

  const api: Api = {
    me: notImplemented,
    login: notImplemented,
    register: notImplemented,
    verifyEmail: notImplemented,
    resendVerification: notImplemented,
    logout: notImplemented,
    listUsers: notImplemented,
    createUser: notImplemented,
    updateSettings: notImplemented,
    deleteUser: notImplemented,
    listCaregivers: notImplemented,
    linkCaregiver: notImplemented,
    generateDeviceCode: notImplemented,
    listAacSymbols: notImplemented,
    createAacSymbol: notImplemented,
    updateAacSymbol: notImplemented,
    deleteAacSymbol: notImplemented,
    uploadAacImage: notImplemented,
    createAacRelation: notImplemented,
    deleteAacRelation: notImplemented,
    searchOpenSymbols: notImplemented,
    attachOpenSymbols: notImplemented,
    listWorkerTokens: notImplemented,
    createWorkerToken: notImplemented,
    revokeWorkerToken: notImplemented,
    listPersonalContext: notImplemented,
    createPersonalContext: notImplemented,
    updatePersonalContext: notImplemented,
    deletePersonalContext: notImplemented,
    ...prefApi,
  };
  return { api, calls };
}

describe('PreferencesPanel (T6.3)', () => {
  it('toont geleerde voorkeuren met zekerheid', async () => {
    const { api } = fakeApi([pref({ suggested: false, suggestionStatus: 'none' })]);
    render(<PreferencesPanel api={api} userId="u-1" userName="Sanne" />);
    await screen.findByText('Wandelen');
    expect(screen.getByText(/3× gekozen · zekerheid 60%/)).toBeTruthy();
  });

  it('accepteert een suggestie en neemt het over als context', async () => {
    const { api, calls } = fakeApi([pref()]);
    render(<PreferencesPanel api={api} userId="u-1" userName="Sanne" />);
    await screen.findByText(/Wil je “Wandelen” toevoegen/);

    fireEvent.click(screen.getByRole('button', { name: 'Toevoegen' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ prefId: 'pref-1', body: { action: 'accept' } });
    // De suggestie is weg; de voorkeur staat nog in de lijst met de nieuwe status.
    await waitFor(() =>
      expect(screen.queryByText(/Wil je “Wandelen” toevoegen/)).toBeNull(),
    );
    expect(screen.getByText(/als context toegevoegd/)).toBeTruthy();
  });

  it('past een suggestie aan met eigen categorie en naam', async () => {
    const { api, calls } = fakeApi([pref()]);
    render(<PreferencesPanel api={api} userId="u-1" userName="Sanne" />);
    await screen.findByText(/Wil je “Wandelen” toevoegen/);

    fireEvent.click(screen.getByRole('button', { name: 'Aanpassen' }));
    const nameField = await screen.findByLabelText('Naam');
    fireEvent.change(nameField, { target: { value: 'Ochtendwandeling' } });
    fireEvent.change(screen.getByLabelText('Categorie'), { target: { value: 'ROUTINE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Toevoegen als context' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({
      action: 'adjust',
      category: 'ROUTINE',
      name: 'Ochtendwandeling',
    });
  });

  it('weigert een suggestie', async () => {
    const { api, calls } = fakeApi([pref()]);
    render(<PreferencesPanel api={api} userId="u-1" userName="Sanne" />);
    await screen.findByText(/Wil je “Wandelen” toevoegen/);

    fireEvent.click(screen.getByRole('button', { name: 'Suggestie Wandelen weigeren' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({ action: 'reject' });
    await screen.findByText(/suggestie geweigerd/);
  });

  it('toont een lege staat zonder voorkeuren', async () => {
    const { api } = fakeApi([]);
    render(<PreferencesPanel api={api} userId="u-1" userName="Sanne" />);
    await screen.findByText(/Nog geen voorkeuren/);
  });
});
