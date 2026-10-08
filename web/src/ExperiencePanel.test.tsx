import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { UserExperience } from '@intento/shared';
import type { Api } from './api.ts';
import { ExperiencePanel } from './ExperiencePanel.tsx';

/** "Ervaring" bij een gebruiker: wat er geleerd is, en wissen (N12.3, §22, §49). */

afterEach(cleanup);

const LEARNED: UserExperience = {
  enabled: true,
  symbols: [
    {
      id: 'v-drink',
      label: 'drinken',
      imageUrl: '/assets/drink.png?exp=1&sig=x',
      presented: 6,
      chosen: 4,
      chosenAtFirstPosition: 3,
      lastUsedAt: '2026-10-07T10:00:00.000Z',
    },
    {
      id: 'v-pain',
      label: 'pijn',
      imageUrl: null,
      presented: 3,
      chosen: 0,
      chosenAtFirstPosition: 0,
      lastUsedAt: null,
    },
  ],
  contacts: [
    {
      id: 'c-mama',
      name: 'Mama',
      presented: 3,
      chosen: 2,
      chosenAtFirstPosition: 2,
      lastUsedAt: '2026-10-06T10:00:00.000Z',
    },
  ],
  modes: [
    {
      mode: 'binary',
      presented: 5,
      chosen: 3,
      chosenAtFirstPosition: 0,
      lastUsedAt: '2026-10-07T10:00:00.000Z',
    },
  ],
  symbolCount: 2,
};

const EMPTY: UserExperience = {
  enabled: true,
  symbols: [],
  contacts: [],
  modes: [],
  symbolCount: 0,
};

function fakeApi(start: UserExperience): { api: Api; cleared: string[] } {
  let current = start;
  const cleared: string[] = [];
  const api = {
    getUserExperience: () => Promise.resolve(current),
    clearUserExperience: (userId: string) => {
      cleared.push(userId);
      current = { ...EMPTY, enabled: current.enabled };
      return Promise.resolve({ deleted: 4 });
    },
  } as Partial<Api> as Api;
  return { api, cleared };
}

describe('ExperiencePanel', () => {
  it('vertelt in gewone taal wat er geleerd is; nooit gekozen staat er niet bij', async () => {
    render(<ExperiencePanel api={fakeApi(LEARNED).api} userId="u-1" userName="Sanne" />);
    const symbols = await screen.findByRole('list', { name: 'Pictogrammen' });
    const drink = within(symbols).getByRole('listitem', { name: 'drinken' });
    expect(drink.textContent).toContain('4 keer gekozen, van de 6 keer dat het te zien was');
    expect(drink.textContent).toContain('laatst 7 oktober');
    expect(within(symbols).queryByRole('listitem', { name: 'pijn' })).toBeNull();

    const contacts = screen.getByRole('list', { name: 'Contacten' });
    expect(contacts.textContent).toContain('Mama');
    expect(contacts.textContent).toContain('2 keer verstuurd');
    expect(screen.getByRole('list', { name: 'Vormen' }).textContent).toContain(
      'Ja of nee5 gesprekken, 3 keer tot een bevestigd bericht',
    );
    expect(screen.getByText(/Het is bewijs, geen waarheid/)).toBeTruthy();
  });

  it('Ervaring wissen: eerst bevestigen, annuleren wist niets', async () => {
    const { api, cleared } = fakeApi(LEARNED);
    render(<ExperiencePanel api={api} userId="u-1" userName="Sanne" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ervaring wissen' }));
    const dialog = screen.getByRole('dialog', { name: 'Ervaring van Sanne wissen?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuleren' }));
    expect(cleared).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Ervaring wissen' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Ervaring van Sanne wissen?' })).getByRole(
        'button',
        { name: 'Ja, wissen' },
      ),
    );
    expect(await screen.findByText('De ervaring van Sanne is gewist.')).toBeTruthy();
    expect(cleared).toEqual(['u-1']);
    expect(screen.getByText('Intento heeft nog niets geleerd van Sanne.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ervaring wissen' })).toBeNull();
  });

  it('nog niets geleerd: geen wisknop', async () => {
    render(<ExperiencePanel api={fakeApi(EMPTY).api} userId="u-1" userName="Sanne" />);
    expect(await screen.findByText('Intento heeft nog niets geleerd van Sanne.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ervaring wissen' })).toBeNull();
  });

  it('leren uit: dat staat erbij, en het bewaarde is nog te wissen', async () => {
    render(
      <ExperiencePanel
        api={fakeApi({ ...LEARNED, enabled: false }).api}
        userId="u-1"
        userName="Sanne"
      />,
    );
    expect((await screen.findByRole('status')).textContent).toContain('Leren staat uit voor Sanne');
    expect(screen.getByRole('button', { name: 'Ervaring wissen' })).toBeTruthy();
  });
});
