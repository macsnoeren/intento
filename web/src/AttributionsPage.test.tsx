import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountPublic } from '@intento/shared';
import { AttributionsPage } from './AttributionsPage.tsx';
import type { Api } from './api.ts';

/** Pagina "Bronnen" (N2.14, INTENTO-NEW-DESIGN §15). */

const admin: AccountPublic = {
  id: 'acc-1',
  email: 'admin@intento.local',
  role: 'ADMIN',
  organizationId: 'org-1',
  name: null,
  emailVerified: true,
  mustChangePassword: false,
  isOperator: false,
};

describe('Bronnen', () => {
  it('noemt per bron licentie, maker en symbolen, en bij Mulberry beide licenties', async () => {
    const base = new Proxy({}, { get: () => () => Promise.reject(new Error('x')) }) as Api;
    const api: Api = {
      ...base,
      listAttributions: () =>
        Promise.resolve({
          sources: [
            {
              sourceName: 'Mulberry Symbols',
              sourceUrl: 'https://globalsymbols.com/symbolsets/mulberry',
              licenseKey: 'CC-BY-SA-4.0',
              licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
              author: 'Steve Lee',
              authorUrl: 'https://mulberrysymbols.org/',
              requiresAttribution: true,
              items: [
                { id: 'v-1', label: 'eten' },
                { id: 'v-2', label: 'drinken' },
              ],
            },
          ],
        }),
    };
    render(
      <AttributionsPage api={api} account={admin} onLogout={() => {}} onNavigate={() => {}} />,
    );
    expect((await screen.findByRole('link', { name: 'CC BY-SA 4.0' })).getAttribute('href')).toBe(
      'https://creativecommons.org/licenses/by-sa/4.0/',
    );
    expect(screen.getByRole('link', { name: 'Steve Lee' })).toBeTruthy();
    expect(screen.getByText('eten, drinken')).toBeTruthy();
    expect(screen.getByText(/CC BY-SA 2\.0 UK/)).toBeTruthy();
  });
});
