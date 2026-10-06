import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountPublic, VocabularyItemPublic } from '@intento/shared';
import { VocabularyUploadDialog } from './VocabularyUploadDialog.tsx';
import { VocabularyPage } from './VocabularyPage.tsx';
import { ApiRequestError, type Api, type VocabularyUpload } from './api.ts';

/** Eigen afbeelding + woord in de beheeromgeving (N8.2, INTENTO-NEW-DESIGN §15, §49). */

const created: VocabularyItemPublic = {
  id: 'v-own',
  scope: 'organization',
  labels: ['opa', 'grootvader'],
  concepts: ['grandfather'],
  contexts: ['people'],
  partOfSpeech: null,
  isStart: false,
  sortOrder: 0,
  status: 'approved',
  labelStatus: 'reviewed',
  source: 'own',
  license: {
    key: 'own',
    url: null,
    author: 'Beheerder',
    authorUrl: null,
    sourceName: null,
    sourceUrl: null,
    sourceRef: null,
    importedAt: '2026-10-06T10:00:00.000Z',
  },
  imageUrl: '/assets/v-own?exp=1&sig=x',
  createdAt: '2026-10-06T10:00:00.000Z',
  updatedAt: '2026-10-06T10:00:00.000Z',
};

function fakeApi(result: Promise<VocabularyItemPublic> = Promise.resolve(created)): {
  api: Api;
  uploads: VocabularyUpload[];
} {
  const uploads: VocabularyUpload[] = [];
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return {
    uploads,
    api: {
      ...base,
      uploadVocabularyItem(upload) {
        uploads.push(upload);
        return result;
      },
      listVocabulary: () => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 24 }),
    },
  };
}

const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'opa.png', { type: 'image/png' });

function fill(): void {
  fireEvent.change(screen.getByLabelText('Afbeelding (PNG, JPEG of WebP)'), {
    target: { files: [png] },
  });
  fireEvent.change(screen.getByLabelText('Woord'), { target: { value: ' opa ' } });
  fireEvent.change(screen.getByLabelText("Synoniemen (met komma's)"), {
    target: { value: 'grootvader, ' },
  });
  fireEvent.change(screen.getByLabelText(/^Concepten/), { target: { value: 'grandfather' } });
  fireEvent.click(screen.getByLabelText('Mensen'));
}

describe('eigen afbeelding toevoegen', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:voorbeeld', revokeObjectURL: () => {} }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('toont een voorbeeld en kan pas opslaan met het vinkje', async () => {
    const { api, uploads } = fakeApi();
    const onCreated = vi.fn();
    render(<VocabularyUploadDialog api={api} onCreated={onCreated} onCancel={() => {}} />);
    fill();
    expect(screen.getByAltText('Voorbeeld van de gekozen afbeelding').getAttribute('src')).toBe(
      'blob:voorbeeld',
    );
    const save = screen.getByRole('button', { name: 'Toevoegen' });
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByLabelText(/Wij mogen deze afbeelding gebruiken/));
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(uploads).toEqual([
      {
        file: png,
        label: 'opa',
        synonyms: ['grootvader'],
        concepts: ['grandfather'],
        contexts: ['people'],
        rightsConfirmed: true,
      },
    ]);
  });

  it('weigert een ander bestandstype al in de browser', () => {
    const { api } = fakeApi();
    render(<VocabularyUploadDialog api={api} onCreated={() => {}} onCancel={() => {}} />);
    const gif = new File(['GIF89a'], 'x.gif', { type: 'image/gif' });
    fireEvent.change(screen.getByLabelText('Afbeelding (PNG, JPEG of WebP)'), {
      target: { files: [gif] },
    });
    expect(screen.getByRole('alert').textContent).toContain('PNG-, JPEG- of WebP');
  });

  it('toont de fout van de server', async () => {
    const { api } = fakeApi(
      Promise.reject(new ApiRequestError(415, 'UNSUPPORTED_IMAGE', 'Alleen PNG, JPEG of WebP.')),
    );
    render(<VocabularyUploadDialog api={api} onCreated={() => {}} onCancel={() => {}} />);
    fill();
    fireEvent.click(screen.getByLabelText(/Wij mogen deze afbeelding gebruiken/));
    fireEvent.click(screen.getByRole('button', { name: 'Toevoegen' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Alleen PNG, JPEG of WebP.');
  });

  it('de knop staat alleen bij de beheerder; na opslaan opent het nieuwe item', async () => {
    const account = (role: AccountPublic['role']): AccountPublic => ({
      id: 'acc-1',
      email: 'x@intento.local',
      role,
      organizationId: 'org-1',
      name: null,
      emailVerified: true,
      mustChangePassword: false,
      isOperator: false,
    });
    const { api } = fakeApi();
    const { unmount } = render(
      <VocabularyPage
        api={api}
        account={account('CAREGIVER')}
        onLogout={() => {}}
        onNavigate={() => {}}
      />,
    );
    await screen.findByText('De Vocabulary is nog leeg.');
    expect(screen.queryByRole('button', { name: '+ Eigen afbeelding toevoegen' })).toBeNull();
    unmount();

    render(
      <VocabularyPage
        api={api}
        account={account('ADMIN')}
        onLogout={() => {}}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '+ Eigen afbeelding toevoegen' }));
    fill();
    fireEvent.click(screen.getByLabelText(/Wij mogen deze afbeelding gebruiken/));
    fireEvent.click(screen.getByRole('button', { name: 'Toevoegen' }));
    expect(await screen.findByRole('heading', { name: 'opa' })).toBeTruthy();
  });
});
