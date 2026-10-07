import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountPublic,
  VocabularyGapPublic,
  VocabularyGapStatus,
  VocabularyItemPublic,
} from '@intento/shared';
import { VocabularyGapsPage } from './VocabularyGapsPage.tsx';
import { ApiRequestError, type Api, type VocabularyUpload } from './api.ts';

/** "Ontbrekende woorden" (N9.2, INTENTO-NEW-DESIGN §17, §49), tegen een in-memory `Api`. */

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

function gap(id: string, label: string, concept: string, occurrences: number): VocabularyGapPublic {
  return {
    id,
    concept,
    label,
    context: 'health',
    occurrences,
    firstSeenAt: '2026-10-01T10:00:00.000Z',
    lastSeenAt: '2026-10-07T10:00:00.000Z',
    status: 'open',
    bestAvailable: { id: 'v-sick', label: 'ziek', imageUrl: '/assets/v-sick?exp=1&sig=x' },
  };
}

function fakeApi(): {
  api: Api;
  actions: [string, string][];
  uploads: VocabularyUpload[];
} {
  const all = [gap('g-1', 'duizelig', 'dizziness', 3), gap('g-2', 'sproeten', 'freckles', 1)];
  const actions: [string, string][] = [];
  const uploads: VocabularyUpload[] = [];
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  const next: Record<string, VocabularyGapStatus> = {
    resolve: 'resolved',
    dismiss: 'dismissed',
    reopen: 'open',
  };
  return {
    actions,
    uploads,
    api: {
      ...base,
      listVocabularyGaps(status = 'open') {
        return Promise.resolve({
          items: all.filter((g) => g.status === status),
          open: all.filter((g) => g.status === 'open').length,
        });
      },
      setVocabularyGapStatus(id, action) {
        actions.push([id, action]);
        const index = all.findIndex((g) => g.id === id);
        const updated = { ...all[index]!, status: next[action] ?? 'open' };
        all[index] = updated;
        return Promise.resolve(updated);
      },
      uploadVocabularyItem(upload) {
        uploads.push(upload);
        return Promise.resolve({ id: 'v-new' } as VocabularyItemPublic);
      },
    },
  };
}

function renderPage(api: Api): void {
  render(
    <VocabularyGapsPage api={api} account={admin} onLogout={() => {}} onNavigate={() => {}} />,
  );
}

describe('ontbrekende woorden', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:voorbeeld', revokeObjectURL: () => {} }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('toont per woord hoe vaak, en welk pictogram de gebruiker zag, met een teller', async () => {
    const { api } = fakeApi();
    renderPage(api);
    const row = await screen.findByRole('listitem', { name: 'duizelig' });
    expect(row.textContent).toContain('3 keer');
    expect(row.textContent).toContain('getoond met "ziek"');
    expect(within(row).getByRole('img').getAttribute('alt')).toBe('In plaats daarvan: ziek');
    expect(screen.getByText('2 woorden open')).toBeTruthy();
  });

  it('negeren haalt een woord uit de lijst; bij Genegeerd kan het weer open', async () => {
    const { api, actions } = fakeApi();
    renderPage(api);
    const row = await screen.findByRole('listitem', { name: 'sproeten' });
    fireEvent.click(within(row).getByRole('button', { name: 'Negeren' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'sproeten' })).toBeNull());
    expect(screen.getByText('1 woord open')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Genegeerd' }));
    const dismissed = await screen.findByRole('listitem', { name: 'sproeten' });
    fireEvent.click(within(dismissed).getByRole('button', { name: 'Weer openzetten' }));
    await waitFor(() => expect(screen.getByText('2 woorden open')).toBeTruthy());
    expect(actions).toEqual([
      ['g-2', 'dismiss'],
      ['g-2', 'reopen'],
    ]);
  });

  it('woord toevoegen: de dialoog is vooraf ingevuld, en daarna is het woord opgelost', async () => {
    const { api, actions, uploads } = fakeApi();
    renderPage(api);
    const row = await screen.findByRole('listitem', { name: 'duizelig' });
    fireEvent.click(within(row).getByRole('button', { name: 'Eigen afbeelding' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText<HTMLInputElement>('Woord').value).toBe('duizelig');
    expect(within(dialog).getByLabelText<HTMLInputElement>(/^Concepten/).value).toBe('dizziness');
    expect(within(dialog).getByLabelText<HTMLInputElement>('Gezondheid').checked).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('Afbeelding (PNG, JPEG of WebP)'), {
      target: { files: [new File([new Uint8Array([0x89, 0x50])], 'd.png', { type: 'image/png' })] },
    });
    fireEvent.click(within(dialog).getByLabelText(/Wij mogen deze afbeelding gebruiken/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Toevoegen' }));

    await waitFor(() => expect(actions).toEqual([['g-1', 'resolve']]));
    expect(uploads[0]).toMatchObject({ label: 'duizelig', concepts: ['dizziness'] });
    expect(await screen.findByText('"duizelig" is toegevoegd aan de Vocabulary.')).toBeTruthy();
    expect(screen.queryByRole('listitem', { name: 'duizelig' })).toBeNull();
  });
});
