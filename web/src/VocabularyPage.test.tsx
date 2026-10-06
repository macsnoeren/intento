import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  AccountPublic,
  VocabularyItemPublic,
  VocabularyListQuery,
  VocabularyListResponse,
} from '@intento/shared';
import { VocabularyPage, licenseLabel } from './VocabularyPage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/** Vocabulary-overzicht (N2.10, INTENTO-NEW-DESIGN §49), tegen een in-memory `Api`. */

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

function item(n: number, overrides: Partial<VocabularyItemPublic> = {}): VocabularyItemPublic {
  return {
    id: `v-${n}`,
    scope: 'platform',
    labels: [`woord ${n}`],
    concepts: [`word_${n}`],
    contexts: ['health'],
    partOfSpeech: 'noun',
    isStart: false,
    sortOrder: n,
    status: 'approved',
    labelStatus: 'reviewed',
    source: 'seed',
    license: {
      key: 'CC-BY-SA-4.0',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      author: 'Steve Lee',
      authorUrl: null,
      sourceName: 'Mulberry Symbols',
      sourceUrl: null,
      sourceRef: String(n),
      importedAt: null,
    },
    imageUrl: `/assets/v-${n}?exp=1&sig=x`,
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    ...overrides,
  };
}

/** Nep-API met `total` items; houdt bij welke query's er gesteld zijn. */
function fakeApi(all: VocabularyItemPublic[]): {
  api: Api;
  queries: Partial<VocabularyListQuery>[];
} {
  const queries: Partial<VocabularyListQuery>[] = [];
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return {
    queries,
    api: {
      ...base,
      listVocabulary(query = {}): Promise<VocabularyListResponse> {
        queries.push(query);
        const q = query.q?.toLowerCase();
        const matches = q ? all.filter((i) => i.labels.some((l) => l.includes(q))) : all;
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 24;
        return Promise.resolve({
          items: matches.slice((page - 1) * pageSize, page * pageSize),
          total: matches.length,
          page,
          pageSize,
        });
      },
    },
  };
}

function renderPage(api: Api): void {
  render(<VocabularyPage api={api} account={admin} onLogout={() => {}} onNavigate={() => {}} />);
}

describe('Vocabulary-overzicht', () => {
  it('meldt een lege Vocabulary', async () => {
    renderPage(fakeApi([]).api);
    expect(await screen.findByText('De Vocabulary is nog leeg.')).toBeTruthy();
  });

  it('toont tegels met pictogram, label, licentie en bron', async () => {
    renderPage(
      fakeApi([
        item(1),
        item(2, { source: 'own', license: { ...item(2).license, key: 'own', sourceName: null } }),
      ]).api,
    );
    const grid = await screen.findByRole('region', { name: 'Symbolen' });
    const first = within(grid).getByLabelText('woord 1');
    expect(within(first).getByText('CC BY-SA 4.0')).toBeTruthy();
    expect(within(first).getByText('Mulberry Symbols')).toBeTruthy();
    expect(first.querySelector('img')?.getAttribute('src')).toContain('/assets/v-1?exp=1&sig=x');
    const second = within(grid).getByLabelText('woord 2');
    expect(within(second).getAllByText('Eigen afbeelding').length).toBeGreaterThan(0);
    expect(screen.getByRole('status').textContent).toContain('2 symbolen');
  });

  it('zoekt en begint dan weer op pagina 1', async () => {
    const { api, queries } = fakeApi([item(1), item(2, { labels: ['hoofdpijn'] })]);
    renderPage(api);
    await screen.findByLabelText('woord 1');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'hoofd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zoeken' }));
    expect(await screen.findByLabelText('hoofdpijn')).toBeTruthy();
    expect(screen.queryByLabelText('woord 1')).toBeNull();
    expect(queries.at(-1)).toMatchObject({ q: 'hoofd', page: 1 });
  });

  it('bladert naar de volgende pagina', async () => {
    const all = Array.from({ length: 30 }, (_, i) => item(i + 1));
    const { api, queries } = fakeApi(all);
    renderPage(api);
    await screen.findByLabelText('woord 1');
    expect(screen.getByText('Pagina 1 van 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vorige' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    expect(await screen.findByLabelText('woord 25')).toBeTruthy();
    expect(screen.getByText('Pagina 2 van 2')).toBeTruthy();
    expect(queries.at(-1)).toMatchObject({ page: 2 });
  });

  it('maakt van een licentiesleutel een leesbare naam', () => {
    expect(licenseLabel('CC-BY-SA-4.0')).toBe('CC BY-SA 4.0');
    expect(licenseLabel('CC0')).toBe('CC0');
    expect(licenseLabel('own')).toBe('Eigen afbeelding');
  });
});

describe('Vocabulary-overzicht: ingetrokken items', () => {
  it('vraagt ingetrokken items op met de keuze "Ingetrokken"', async () => {
    const { api, queries } = fakeApi([]);
    renderPage(api);
    await screen.findByText('De Vocabulary is nog leeg.');
    fireEvent.change(screen.getByLabelText('Toon'), { target: { value: 'retired' } });
    expect(await screen.findByText('Er zijn geen ingetrokken symbolen.')).toBeTruthy();
    expect(queries.at(-1)).toMatchObject({ status: 'retired', page: 1 });
  });
});
