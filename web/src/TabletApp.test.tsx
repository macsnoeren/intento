import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CommunicationProfile, DeviceSessionResponse, UserPublic } from '@intento/shared';
import { TabletApp } from './TabletApp.tsx';
import { ApiRequestError, type DeviceApi } from './api.ts';

/**
 * Web-tests voor de gebruikersapp op de tablet. Draaien tegen een in-memory `DeviceApi`, zodat
 * koppelen en het scherm daarna zonder netwerk getest worden. De gespreksflow wordt herbouwd
 * (ADR-0017); tot dan toont een gekoppelde tablet "Nog niet beschikbaar".
 */

function profile(overrides: Partial<CommunicationProfile> = {}): CommunicationProfile {
  return {
    showText: true,
    speechEnabled: false,
    speechVoice: 'nl_NL-pim-medium',
    ...overrides,
  };
}

function makeUser(name = 'Sanne', comm: CommunicationProfile = profile()): UserPublic {
  return {
    id: 'u-1',
    name,
    organizationId: 'org-1',
    active: true,
    createdAt: '2026-07-10T10:00:00.000Z',
    communicationProfile: comm,
  };
}

function sessionFor(user: UserPublic): DeviceSessionResponse {
  return {
    device: { id: 'd-1', userId: user.id, type: 'tablet', lastActive: user.createdAt },
    user,
  };
}

/** Nep-tablet-backend; `linked` bepaalt of het apparaat al gekoppeld is. Telt de `deviceMe`-aanroepen. */
function fakeDeviceApi(options: { linked?: boolean; names?: string[] } = {}): {
  api: DeviceApi;
  calls: () => number;
} {
  let linked = options.linked ?? false;
  const names = options.names ?? ['Sanne'];
  let calls = 0;
  return {
    calls: () => calls,
    api: {
      deviceMe() {
        calls += 1;
        if (!linked) {
          return Promise.reject(new ApiRequestError(401, 'UNAUTHORIZED', 'Niet gekoppeld.'));
        }
        const name = names[Math.min(calls - 1, names.length - 1)] ?? 'Sanne';
        return Promise.resolve(sessionFor(makeUser(name)));
      },
      linkDevice(code) {
        if (code !== 'ABCD2345') {
          return Promise.reject(new ApiRequestError(400, 'INVALID_CODE', 'Koppelcode ongeldig.'));
        }
        linked = true;
        return Promise.resolve(sessionFor(makeUser(names[0])));
      },
      speakText() {
        return Promise.resolve(new Blob());
      },
      listAttributions() {
        return Promise.resolve({
          sources: [
            {
              sourceName: 'Mulberry Symbols',
              sourceUrl: 'https://globalsymbols.com/symbolsets/mulberry',
              licenseKey: 'CC-BY-SA-4.0',
              licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
              author: 'Steve Lee',
              authorUrl: null,
              requiresAttribution: true,
              items: [{ id: 'v-1', label: 'pijn' }],
            },
          ],
        });
      },
    },
  };
}

describe('gebruikersapp op de tablet', () => {
  it('toont het koppelscherm wanneer het apparaat nog niet gekoppeld is', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: false }).api} />);
    expect(await screen.findByRole('button', { name: 'Koppelen' })).toBeTruthy();
  });

  it('koppelt met een geldige code en toont daarna "Nog niet beschikbaar"', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: false }).api} />);
    await screen.findByRole('button', { name: 'Koppelen' });

    fireEvent.change(screen.getByLabelText('Koppelcode'), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Koppelen' }));

    expect(await screen.findByRole('heading', { name: 'Nog niet beschikbaar' })).toBeTruthy();
    // Er staat geen enkele knop van de oude gespreksflow meer op het scherm; alleen de bronnenlink.
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(['Bronnen']);
  });

  it('toont een fout bij een ongeldige koppelcode', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: false }).api} />);
    await screen.findByRole('button', { name: 'Koppelen' });

    fireEvent.change(screen.getByLabelText('Koppelcode'), { target: { value: 'FOUTFOUT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Koppelen' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Koppelcode ongeldig');
  });

  it('zet de naam van de app en van de gebruiker in de kopbalk', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true }).api} />);
    await screen.findByRole('heading', { name: 'Nog niet beschikbaar' });

    const header = screen.getByRole('banner');
    expect(within(header).getByText('Intento')).toBeTruthy();
    expect(within(header).getByText('Sanne')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('haalt de sessie opnieuw op zodra de tablet weer op de voorgrond komt', async () => {
    const { api, calls } = fakeDeviceApi({ linked: true, names: ['Sanne', 'Sanne B.'] });
    render(<TabletApp api={api} />);
    await screen.findByText('Sanne');

    fireEvent(document, new Event('visibilitychange'));

    expect(await screen.findByText('Sanne B.')).toBeTruthy();
    await waitFor(() => expect(calls()).toBe(2));
  });

  it('toont via "Bronnen" de bronvermelding en gaat terug (N2.14)', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true }).api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bronnen' }));
    expect(await screen.findByRole('link', { name: 'Mulberry Symbols' })).toBeTruthy();
    expect(screen.getByText('CC BY-SA 4.0')).toBeTruthy();
    expect(screen.getByText('Steve Lee')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '↩ Terug' }));
    expect(await screen.findByRole('heading', { name: 'Nog niet beschikbaar' })).toBeTruthy();
  });
});
