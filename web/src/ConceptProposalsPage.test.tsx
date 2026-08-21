import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountPublic, ConceptProposal } from '@intento/shared';
import { ConceptProposalsPage } from './ConceptProposalsPage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor de reviewlijst van AI-conceptvoorstellen (T7.3). Draaien tegen een in-memory `Api`
 * (de server-kant is met API-tests gedekt). Toetst de acceptatie in de UI: een openstaand voorstel
 * verschijnt, wordt via een pictogramzoekactie gekoppeld/goedgekeurd of afgewezen.
 */

const adminAccount: AccountPublic = {
  id: 'acc-1',
  email: 'admin@intento.local',
  role: 'ADMIN',
  organizationId: 'org-1',
  name: null,
  emailVerified: true,
};

function proposal(overrides: Partial<ConceptProposal> & { id: string; concept: string }): ConceptProposal {
  return {
    reason: 'de gebruiker wilde dit',
    status: 'PENDING',
    linkedSymbol: null,
    createdAt: '2026-07-12T09:00:00.000Z',
    updatedAt: '2026-07-12T09:00:00.000Z',
    ...overrides,
  };
}

/** Stateful nep-backend: voorstellen kunnen goedgekeurd/afgewezen worden; zoeken geeft één pictogram. */
function fakeApi(initial: ConceptProposal[]): Api {
  let proposals = [...initial];
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return {
    ...base,
    listConceptProposals: () => Promise.resolve({ proposals: [...proposals] }),
    searchAac: (q) =>
      Promise.resolve({
        symbols: [
          {
            id: 's-walking',
            concept: 'walking',
            label: `Wandelen (${q})`,
            category: 'activity',
            glyph: '🚶',
            imageUrl: '/aac/images/s-walking',
            synonyms: [],
            attribution: null,
          },
        ],
      }),
    approveConceptProposal: (id, symbolId) => {
      proposals = proposals.map((p) =>
        p.id === id
          ? {
              ...p,
              status: 'APPROVED',
              linkedSymbol: {
                id: symbolId,
                concept: 'walking',
                label: 'Wandelen',
                category: 'activity',
                glyph: '🚶',
                imageUrl: '/aac/images/s-walking',
                synonyms: [],
                attribution: null,
              },
            }
          : p,
      );
      const updated = proposals.find((p) => p.id === id)!;
      return Promise.resolve(updated);
    },
    rejectConceptProposal: (id) => {
      proposals = proposals.map((p) => (p.id === id ? { ...p, status: 'REJECTED' } : p));
      return Promise.resolve(proposals.find((p) => p.id === id)!);
    },
  };
}

describe('conceptvoorstellen — reviewlijst', () => {
  it('toont een openstaand voorstel', async () => {
    const api = fakeApi([proposal({ id: 'p-1', concept: 'teleporteren' })]);
    render(
      <ConceptProposalsPage api={api} account={adminAccount} onLogout={() => {}} onNavigate={() => {}} />,
    );
    expect(await screen.findByText('teleporteren')).toBeTruthy();
    expect(screen.getByText('Openstaand')).toBeTruthy();
  });

  it('keurt een voorstel goed door het aan een gezocht pictogram te koppelen', async () => {
    const api = fakeApi([proposal({ id: 'p-1', concept: 'teleporteren' })]);
    render(
      <ConceptProposalsPage api={api} account={adminAccount} onLogout={() => {}} onNavigate={() => {}} />,
    );

    const item = (await screen.findByText('teleporteren')).closest('li') as HTMLElement;
    // Zoek een pictogram om aan te koppelen.
    fireEvent.change(within(item).getByLabelText('Zoek een pictogram'), {
      target: { value: 'wandelen' },
    });
    fireEvent.click(within(item).getByRole('button', { name: 'Zoeken' }));
    fireEvent.click(await within(item).findByRole('button', { name: /Koppelen aan/i }));

    // Na goedkeuring is het voorstel goedgekeurd en toont de koppeling.
    expect(await screen.findByText('Goedgekeurd')).toBeTruthy();
    expect(screen.getByText(/Gekoppeld aan:/)).toBeTruthy();
  });

  it('wijst een voorstel af', async () => {
    const api = fakeApi([proposal({ id: 'p-1', concept: 'teleporteren' })]);
    render(
      <ConceptProposalsPage api={api} account={adminAccount} onLogout={() => {}} onNavigate={() => {}} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Voorstel teleporteren afwijzen/i }));
    expect(await screen.findByText('Afgewezen')).toBeTruthy();
    // Geen zoek-/afwijsknoppen meer voor een afgehandeld voorstel.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /afwijzen/i })).toBeNull(),
    );
  });
});
