import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExternalImportRequest, ExternalSymbol, VocabularyItemPublic } from '@intento/shared';
import { ExternalImportDialog } from './ExternalImportDialog.tsx';
import { ApiRequestError, type Api } from './api.ts';

/** Importeren uit een externe bron in de beheeromgeving (N8.6, INTENTO-NEW-DESIGN §15, §49). */

function symbol(id: string, name: string, licenseKey: string, allowed: boolean): ExternalSymbol {
  return {
    id,
    name,
    imageUrl: `https://example.org/${id}.png`,
    extension: 'png',
    license: licenseKey === 'UNKNOWN' ? 'onbekend' : licenseKey,
    licenseUrl: null,
    author: 'Iemand',
    authorUrl: null,
    sourceUrl: null,
    licenseKey,
    allowed,
  };
}

const RESULTS = [
  symbol('1', 'Feel Dizzy', 'CC-BY-SA-4.0', true),
  symbol('2', 'dizzy nc', 'CC-BY-NC-SA-4.0', false),
  symbol('3', 'iets', 'UNKNOWN', false),
];

const imported = { id: 'v-imp', labels: ['duizelig'] } as VocabularyItemPublic;

function fakeApi(
  search: Promise<{ results: ExternalSymbol[] }> = Promise.resolve({ results: RESULTS }),
) {
  const imports: ExternalImportRequest[] = [];
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  const api: Api = {
    ...base,
    searchExternal: () => search,
    importExternal(body) {
      imports.push(body);
      return Promise.resolve(imported);
    },
  };
  return { api, imports };
}

async function searchFor(q: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Zoeken in OpenSymbols'), { target: { value: q } });
  fireEvent.click(screen.getByRole('button', { name: 'Zoeken' }));
  await screen.findByRole('list', { name: 'Resultaten' });
}

describe('importeren uit een externe bron', () => {
  it('markeert resultaten met een niet-toegestane licentie en maakt ze onkiesbaar', async () => {
    const { api } = fakeApi();
    render(<ExternalImportDialog api={api} onCreated={() => {}} onCancel={() => {}} />);
    await searchFor('dizzy');
    const allowed = screen.getByRole('button', { name: 'Feel Dizzy (CC BY-SA 4.0)' });
    const nc = screen.getByRole('button', { name: 'dizzy nc (CC BY-NC-SA 4.0)' });
    const unknown = screen.getByRole('button', { name: 'iets (UNKNOWN)' });
    expect(allowed.hasAttribute('disabled')).toBe(false);
    expect(nc.hasAttribute('disabled')).toBe(true);
    expect(unknown.hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText('Licentie niet toegestaan')).toHaveLength(2);
    expect(screen.getByText('onbekend')).toBeTruthy();
  });

  it('importeert een gekozen resultaat met het eigen woord', async () => {
    const { api, imports } = fakeApi();
    const onCreated = vi.fn();
    render(<ExternalImportDialog api={api} onCreated={onCreated} onCancel={() => {}} />);
    await searchFor(' dizzy ');
    fireEvent.click(screen.getByRole('button', { name: 'Feel Dizzy (CC BY-SA 4.0)' }));
    const go = screen.getByRole('button', { name: 'Importeren' });
    expect(go.hasAttribute('disabled')).toBe(true); // nog geen woord
    fireEvent.change(screen.getByLabelText('Woord (Nederlands)'), {
      target: { value: 'duizelig' },
    });
    fireEvent.click(screen.getByLabelText('Gezondheid'));
    fireEvent.click(go);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(imported));
    expect(imports).toEqual([
      {
        query: 'dizzy',
        id: '1',
        label: 'duizelig',
        synonyms: [],
        concepts: ['feel_dizzy'],
        contexts: ['health'],
      },
    ]);
  });

  it('vooraf ingevuld (ontbrekend woord): zoekterm, en woord en concept blijven na de keuze', async () => {
    const { api, imports } = fakeApi();
    render(
      <ExternalImportDialog
        api={api}
        initial={{
          label: 'duizelig',
          concepts: ['dizziness'],
          contexts: ['health'],
          query: 'dizziness',
        }}
        onCreated={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByLabelText<HTMLInputElement>('Zoeken in OpenSymbols').value).toBe(
      'dizziness',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Zoeken' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Feel Dizzy (CC BY-SA 4.0)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Importeren' }));
    await waitFor(() => expect(imports).toHaveLength(1));
    expect(imports[0]).toMatchObject({
      label: 'duizelig',
      concepts: ['dizziness'],
      contexts: ['health'],
    });
  });

  it('toont waarom zoeken niet lukt', async () => {
    const { api } = fakeApi(
      Promise.reject(
        new ApiRequestError(
          503,
          'EXTERNAL_SOURCE_UNAVAILABLE',
          'Zoeken in een externe bron is niet ingesteld (OPENSYMBOLS_SECRET).',
        ),
      ),
    );
    render(<ExternalImportDialog api={api} onCreated={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Zoeken in OpenSymbols'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zoeken' }));
    expect((await screen.findByRole('alert')).textContent).toContain('niet ingesteld');
  });
});
