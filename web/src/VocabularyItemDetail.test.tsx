import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AccountPublic, VocabularyItemPublic, VocabularyUpdateRequest } from '@intento/shared';
import { VocabularyItemDetail } from './VocabularyItemDetail.tsx';
import { ApiRequestError, type Api } from './api.ts';

/** Detailscherm van een Vocabulary-item (N2.12, INTENTO-NEW-DESIGN §49). */

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

const item: VocabularyItemPublic = {
  id: 'v-1',
  scope: 'organization',
  labels: ['hoofd'],
  concepts: ['head'],
  contexts: ['body'],
  partOfSpeech: 'noun',
  isStart: false,
  sortOrder: 10,
  status: 'approved',
  labelStatus: 'machine',
  source: 'seed',
  license: {
    key: 'CC-BY-SA-4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    author: 'Steve Lee',
    authorUrl: 'https://mulberrysymbols.org/',
    sourceName: 'Mulberry Symbols',
    sourceUrl: 'https://globalsymbols.com/symbolsets/mulberry',
    sourceRef: '4743',
    importedAt: null,
  },
  imageUrl: '/assets/v-1?exp=1&sig=x',
  createdAt: '2026-10-06T10:00:00.000Z',
  updatedAt: '2026-10-06T10:00:00.000Z',
};

function apiWith(
  update: (id: string, body: VocabularyUpdateRequest) => Promise<VocabularyItemPublic>,
): Api {
  const base = new Proxy(
    {},
    { get: () => () => Promise.reject(new Error('niet in deze test')) },
  ) as Api;
  return { ...base, updateVocabularyItem: update };
}

function renderDetail(api: Api, account = admin, onSaved = vi.fn(), onBack = vi.fn()) {
  render(
    <VocabularyItemDetail
      api={api}
      account={account}
      item={item}
      onBack={onBack}
      onSaved={onSaved}
      onLogout={() => {}}
      onNavigate={() => {}}
    />,
  );
  return { onSaved, onBack };
}

describe('Vocabulary-item: detail', () => {
  it('toont pictogram, licentie met link, maker, bron en vertaalstatus', () => {
    renderDetail(apiWith(vi.fn()));
    expect(screen.getByRole('img', { name: 'hoofd' }).getAttribute('src')).toContain('/assets/v-1');
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' }).getAttribute('href')).toBe(
      'https://creativecommons.org/licenses/by-sa/4.0/',
    );
    expect(screen.getByRole('link', { name: 'Mulberry Symbols' })).toBeTruthy();
    expect(screen.getByText('Machinevertaling, nog niet nagekeken')).toBeTruthy();
  });

  it('slaat de wijzigingen op en meldt het resultaat terug', async () => {
    const update = vi.fn((_id: string, body: VocabularyUpdateRequest) =>
      Promise.resolve({
        ...item,
        ...body,
        labelStatus: 'reviewed' as const,
      } as VocabularyItemPublic),
    );
    const { onSaved } = renderDetail(apiWith(update));

    fireEvent.change(screen.getByLabelText(/Labels/), { target: { value: 'kop, hoofd' } });
    fireEvent.click(screen.getByLabelText('Gezondheid'));
    fireEvent.click(screen.getByLabelText(/Startconcept/));
    fireEvent.change(screen.getByLabelText('Volgorde'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith('v-1', {
      labels: ['kop', 'hoofd'],
      concepts: ['head'],
      contexts: ['body', 'health'],
      isStart: true,
      sortOrder: 3,
    });
    expect(screen.getByRole('status').textContent).toBe('Opgeslagen');
  });

  it('valideert vóór het versturen', async () => {
    const update = vi.fn();
    renderDetail(apiWith(update));
    fireEvent.change(screen.getByLabelText(/Concepten/), { target: { value: 'Hoofd Pijn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/kleine letters/);
    expect(update).not.toHaveBeenCalled();
  });

  it('toont de melding van de server, bv. bij een platformitem', async () => {
    renderDetail(
      apiWith(() =>
        Promise.reject(
          new ApiRequestError(
            403,
            'PLATFORM_ITEM',
            'Alleen de platformbeheerder kan dit wijzigen.',
          ),
        ),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Alleen de platformbeheerder kan dit wijzigen.',
    );
  });

  it('laat een begeleider lezen maar niet bewerken', () => {
    renderDetail(apiWith(vi.fn()), { ...admin, role: 'CAREGIVER' });
    expect(screen.queryByRole('button', { name: 'Opslaan' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Betekenis' }).textContent).toContain('head');
  });

  it('gaat terug naar het overzicht', () => {
    const { onBack } = renderDetail(apiWith(vi.fn()));
    fireEvent.click(screen.getByRole('button', { name: /Alle symbolen/ }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('Vocabulary-item: intrekken', () => {
  it('trekt pas in na bevestiging, en meldt het nieuwe item terug', async () => {
    const setStatus = vi.fn(() =>
      Promise.resolve({ ...item, status: 'retired' as const, imageUrl: null }),
    );
    const base = apiWith(vi.fn());
    const api = { ...base, setVocabularyItemStatus: setStatus } as Api;
    const { onSaved } = renderDetail(api);

    fireEvent.click(screen.getByRole('button', { name: 'Intrekken…' }));
    expect(setStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ja, intrekken' }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ status: 'retired' })),
    );
    expect(setStatus).toHaveBeenCalledWith('v-1', 'retire');
  });

  it('zet een ingetrokken item terug', async () => {
    const setStatus = vi.fn(() => Promise.resolve({ ...item, status: 'approved' as const }));
    const api = { ...apiWith(vi.fn()), setVocabularyItemStatus: setStatus } as Api;
    render(
      <VocabularyItemDetail
        api={api}
        account={admin}
        item={{ ...item, status: 'retired', imageUrl: null }}
        onBack={() => {}}
        onSaved={() => {}}
        onLogout={() => {}}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Weer gebruiken' }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('v-1', 'restore'));
  });

  it('toont geen intrekknop aan een begeleider', () => {
    renderDetail(apiWith(vi.fn()), { ...admin, role: 'CAREGIVER' });
    expect(screen.queryByRole('button', { name: 'Intrekken…' })).toBeNull();
  });
});
