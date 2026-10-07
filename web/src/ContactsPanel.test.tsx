import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  ContactCreateRequest,
  ContactPublic,
  ContactUpdateRequest,
  VocabularyItemPublic,
} from '@intento/shared';
import { ContactsPanel } from './ContactsPanel.tsx';
import { ApiRequestError, type Api } from './api.ts';

/** Contacten bij een gebruiker in de beheeromgeving (N10.3, INTENTO-NEW-DESIGN §28, §49). */

function contact(id: string, name: string, overrides: Partial<ContactPublic> = {}): ContactPublic {
  return {
    id,
    userId: 'u-1',
    name,
    relation: null,
    email: `${name.toLowerCase()}@example.org`,
    emailVerified: true,
    active: true,
    sortOrder: 0,
    symbol: null,
    createdAt: '2026-10-07T10:00:00.000Z',
    updatedAt: '2026-10-07T10:00:00.000Z',
    ...overrides,
  };
}

const MOTHER = {
  id: 'v-mother',
  labels: ['moeder'],
  imageUrl: '/assets/v-mother?exp=1&sig=x',
} as VocabularyItemPublic;

function fakeApi(initial: ContactPublic[]) {
  let contacts = [...initial];
  const created: ContactCreateRequest[] = [];
  const updates: [string, ContactUpdateRequest][] = [];
  const resent: string[] = [];
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  const sorted = () => [...contacts].sort((a, b) => a.sortOrder - b.sortOrder);
  const api: Api = {
    ...base,
    listContacts: () => Promise.resolve({ contacts: sorted() }),
    createContact(_userId, body) {
      created.push(body);
      const next = contact(`c-${contacts.length + 1}`, body.name, {
        email: body.email.toLowerCase(),
        relation: body.relation ?? null,
        emailVerified: false,
        sortOrder: contacts.length,
        symbol: body.vocabularyItemId
          ? { id: body.vocabularyItemId, label: 'moeder', imageUrl: null }
          : null,
      });
      contacts.push(next);
      return Promise.resolve(next);
    },
    updateContact(_userId, id, body) {
      updates.push([id, body]);
      contacts = contacts.map((c) =>
        c.id === id
          ? {
              ...c,
              ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
              ...(body.name !== undefined ? { name: body.name } : {}),
            }
          : c,
      );
      return Promise.resolve(contacts.find((c) => c.id === id)!);
    },
    deleteContact(_userId, id) {
      contacts = contacts.filter((c) => c.id !== id);
      return Promise.resolve();
    },
    resendContactVerification(_userId, id) {
      resent.push(id);
      return Promise.resolve();
    },
    listVocabulary: () =>
      Promise.resolve({ items: [MOTHER], total: 1, page: 1, pageSize: 12, machineOpen: 0 }),
  };
  return { api, created, updates, resent };
}

function renderPanel(api: Api): void {
  render(<ContactsPanel api={api} userId="u-1" userName="Sanne" />);
}

describe('contacten', () => {
  it('toont de contacten in volgorde met hun status', async () => {
    const { api } = fakeApi([
      contact('c-1', 'Mama', { sortOrder: 0, relation: 'moeder' }),
      contact('c-2', 'Tim', { sortOrder: 1, emailVerified: false }),
      contact('c-3', 'Oma', { sortOrder: 2, active: false }),
    ]);
    renderPanel(api);
    const rows = await screen.findAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Mama', 'Tim', 'Oma']);
    expect(rows[0]?.textContent).toContain('moeder');
    expect(rows[0]?.textContent).toContain('Bevestigd');
    expect(rows[1]?.textContent).toContain('Wacht op bevestiging');
    expect(rows[2]?.textContent).toContain('Uit');
    // Alleen een onbevestigd contact kan de mail opnieuw krijgen.
    expect(within(rows[0]!).queryByRole('button', { name: 'Opnieuw versturen' })).toBeNull();
    expect(within(rows[1]!).getByRole('button', { name: 'Opnieuw versturen' })).toBeTruthy();
  });

  it('voegt een contact toe met een pictogram uit de Vocabulary', async () => {
    const { api, created } = fakeApi([]);
    renderPanel(api);
    await screen.findByText('Nog geen contacten.');
    fireEvent.click(screen.getByRole('button', { name: '+ Contact toevoegen' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Naam/), { target: { value: 'Mama' } });
    fireEvent.change(within(dialog).getByLabelText(/^Relatie/), { target: { value: 'moeder' } });
    fireEvent.change(within(dialog).getByLabelText('E-mailadres'), {
      target: { value: 'Mama@Example.org' },
    });
    fireEvent.change(within(dialog).getByLabelText('Pictogram zoeken'), {
      target: { value: 'moeder' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zoeken' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'moeder' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Opslaan' }));

    expect(
      await screen.findByText(/Er is een bevestigingsmail naar mama@example.org/),
    ).toBeTruthy();
    expect(created).toEqual([
      {
        name: 'Mama',
        relation: 'moeder',
        email: 'mama@example.org',
        vocabularyItemId: 'v-mother',
      },
    ]);
    expect(await screen.findByRole('listitem', { name: 'Mama' })).toBeTruthy();
  });

  it('weigert een ongeldig e-mailadres zonder iets te versturen', async () => {
    const { api, created } = fakeApi([]);
    renderPanel(api);
    fireEvent.click(await screen.findByRole('button', { name: '+ Contact toevoegen' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Naam/), { target: { value: 'Mama' } });
    fireEvent.change(within(dialog).getByLabelText('E-mailadres'), { target: { value: 'mama' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Opslaan' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('e-mailadres');
    expect(created).toEqual([]);
  });

  it('verplaatst een contact en verstuurt de bevestiging opnieuw', async () => {
    const { api, updates, resent } = fakeApi([
      contact('c-1', 'Mama', { sortOrder: 0 }),
      contact('c-2', 'Tim', { sortOrder: 1, emailVerified: false }),
    ]);
    renderPanel(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Tim omhoog' }));
    await waitFor(async () =>
      expect(
        (await screen.findAllByRole('listitem')).map((r) => r.getAttribute('aria-label')),
      ).toEqual(['Tim', 'Mama']),
    );
    expect(updates).toEqual([
      ['c-2', { sortOrder: 0 }],
      ['c-1', { sortOrder: 1 }],
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw versturen' }));
    expect(await screen.findByText(/opnieuw naar tim@example.org gestuurd/)).toBeTruthy();
    expect(resent).toEqual(['c-2']);
  });

  it('verwijdert pas na bevestigen', async () => {
    const { api } = fakeApi([contact('c-1', 'Mama')]);
    renderPanel(api);
    const row = await screen.findByRole('listitem', { name: 'Mama' });
    fireEvent.click(within(row).getByRole('button', { name: 'Verwijderen' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ja, verwijderen' }));
    expect(await screen.findByText('Nog geen contacten.')).toBeTruthy();
  });
});
