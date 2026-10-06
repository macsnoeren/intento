import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AccountPublic, UpdateSettingsRequest, UserPublic } from '@intento/shared';
import { CaregiverUsersPage } from './CaregiverUsersPage.tsx';
import type { Api } from './api.ts';

/** Begeleider — "Mijn gebruikers" (N3.4, INTENTO-NEW-DESIGN §49, V7). */

const caregiver: AccountPublic = {
  id: 'acc-2',
  email: 'cg@intento.local',
  role: 'CAREGIVER',
  organizationId: 'org-1',
  name: 'Bram',
  emailVerified: true,
  mustChangePassword: false,
  isOperator: false,
};

const sanne: UserPublic = {
  id: 'u-1',
  name: 'Sanne',
  organizationId: 'org-1',
  active: true,
  createdAt: '2026-10-06T10:00:00.000Z',
  communicationProfile: {
    interactionMode: 'binary',
    optionsPerScreen: 4,
    questionStrategy: 'general_to_specific',
    experienceEnabled: true,
    maxQuestions: 15,
    showText: true,
    speechEnabled: false,
    speechVoice: 'nl_NL-pim-medium',
  },
};

function fakeApi(users: UserPublic[]) {
  const updateSettings = vi.fn((id: string, body: UpdateSettingsRequest) =>
    Promise.resolve({ ...users.find((u) => u.id === id)!, communicationProfile: body }),
  );
  const base = new Proxy({}, { get: () => () => Promise.reject(new Error('x')) }) as Api;
  const api: Api = {
    ...base,
    listCaregiverUsers: () => Promise.resolve({ users }),
    updateSettings,
  };
  return { api, updateSettings };
}

describe('Mijn gebruikers', () => {
  it('meldt het als de begeleider nog aan niemand gekoppeld is', async () => {
    render(
      <CaregiverUsersPage
        api={fakeApi([]).api}
        account={caregiver}
        onLogout={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(await screen.findByText(/nog aan niemand gekoppeld/)).toBeTruthy();
  });

  it('opent een gekoppelde gebruiker en slaat zijn instellingen op', async () => {
    const { api, updateSettings } = fakeApi([sanne]);
    render(
      <CaregiverUsersPage
        api={api}
        account={caregiver}
        onLogout={() => {}}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Sanne' }));
    fireEvent.click(screen.getByRole('radio', { name: /Kort en rustig/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Instellingen opslaan' }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        'u-1',
        expect.objectContaining({ questionStrategy: 'short_and_calm' }),
      ),
    );
    const back = screen
      .getAllByRole('button', { name: /Mijn gebruikers/ })
      .find((button) => button.classList.contains('detail-back'));
    fireEvent.click(back!);
    expect(await screen.findByRole('heading', { name: 'Mijn gebruikers' })).toBeTruthy();
  });
});
