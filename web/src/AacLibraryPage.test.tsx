import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  AacSymbolAdmin,
  AacSymbolInput,
  AacSymbolListResponse,
  AccountPublic,
} from '@intento/shared';
import { AacLibraryPage } from './AacLibraryPage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor het AAC-bibliotheekbeheer (T3.2). Draaien tegen een in-memory `Api`, zodat de
 * beheerflow (symbool toevoegen → relatie leggen → terugvinden via zoeken → afbeelding uploaden)
 * zonder netwerk getest wordt. De server-kant is gedekt door de API-tests.
 */

const adminAccount: AccountPublic = {
  id: 'acc-1',
  email: 'admin@intento.local',
  role: 'ADMIN',
  organizationId: 'org-1',
  name: null,
  emailVerified: true,
  mustChangePassword: false,
  isOperator: false,
};

function makeSymbol(
  overrides: Partial<AacSymbolAdmin> & { id: string; concept: string },
): AacSymbolAdmin {
  return {
    label: overrides.label ?? overrides.concept,
    category: overrides.category ?? 'activity',
    glyph: overrides.glyph ?? '🔷',
    synonyms: overrides.synonyms ?? [],
    imageUrl: `/aac/images/${overrides.id}`,
    attribution: overrides.attribution ?? null,
    isNew: overrides.isNew ?? false,
    hasImage: overrides.hasImage ?? false,
    children: overrides.children ?? [],
    parents: overrides.parents ?? [],
    ...overrides,
  };
}

/** Stateful nep-backend voor het AAC-beheer; ongebruikte `Api`-methoden werpen. */
function fakeApi(): Api {
  const symbols: AacSymbolAdmin[] = [
    makeSymbol({
      id: 's-outside',
      concept: 'outside',
      label: 'Buiten',
      category: 'place',
      glyph: '🌳',
    }),
    makeSymbol({
      id: 's-walking',
      concept: 'walking',
      label: 'Wandelen',
      glyph: '🚶',
      synonyms: ['lopen'],
    }),
  ];
  let counter = 0;

  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));

  return {
    me: notImplemented,
    login: notImplemented,
    register: notImplemented,
    verifyEmail: notImplemented,
    resendVerification: notImplemented,
    changePassword: notImplemented,
    logout: () => Promise.resolve(),
    listUsers: notImplemented,
    createUser: notImplemented,
    updateSettings: notImplemented,
    deleteUser: () => Promise.resolve(),
    createCaregiverAccount: notImplemented,
    listAccounts: notImplemented,
    resetAccountPassword: notImplemented,
    listCaregivers: notImplemented,
    linkCaregiver: notImplemented,
    generateDeviceCode: notImplemented,
    listAacSymbols(filter): Promise<AacSymbolListResponse> {
      let list = [...symbols];
      if (filter?.q) {
        const q = filter.q.toLowerCase();
        list = list.filter(
          (s) =>
            s.concept.includes(q) ||
            s.label.toLowerCase().includes(q) ||
            s.synonyms.some((syn) => syn.toLowerCase().includes(q)),
        );
      }
      if (filter?.category) list = list.filter((s) => s.category === filter.category);
      return Promise.resolve({ symbols: list });
    },
    createAacSymbol(body: AacSymbolInput): Promise<AacSymbolAdmin> {
      if (symbols.some((s) => s.concept === body.concept)) {
        return Promise.reject(new ApiRequestError(409, 'CONCEPT_EXISTS', 'Concept bestaat al.'));
      }
      const created = makeSymbol({ id: `new-${++counter}`, ...body });
      symbols.push(created);
      return Promise.resolve(created);
    },
    updateAacSymbol(id: string, body: AacSymbolInput): Promise<AacSymbolAdmin> {
      const index = symbols.findIndex((s) => s.id === id);
      const updated = { ...symbols[index]!, ...body };
      symbols[index] = updated;
      return Promise.resolve(updated);
    },
    deleteAacSymbol(id: string): Promise<void> {
      const index = symbols.findIndex((s) => s.id === id);
      if (index >= 0) symbols.splice(index, 1);
      return Promise.resolve();
    },
    uploadAacImage(id: string, file: File): Promise<AacSymbolAdmin> {
      if (!file.type.startsWith('image/')) {
        return Promise.reject(
          new ApiRequestError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Alleen afbeeldingen toegestaan.'),
        );
      }
      const index = symbols.findIndex((s) => s.id === id);
      const updated = { ...symbols[index]!, hasImage: true, imageUrl: `/aac/images/${id}?v=1` };
      symbols[index] = updated;
      return Promise.resolve(updated);
    },
    searchOpenSymbols(q: string) {
      if (q.toLowerCase() === 'leeg') return Promise.resolve({ results: [] });
      return Promise.resolve({
        results: [
          {
            id: 'os-1',
            name: `${q}-pictogram`,
            imageUrl: 'https://example.org/os-1.png',
            extension: 'png',
            license: 'CC BY-SA',
            licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
            author: 'ARASAAC',
            authorUrl: 'https://arasaac.org',
            sourceUrl: 'https://www.opensymbols.org/symbols/os-1',
          },
        ],
      });
    },
    attachOpenSymbols(id: string): Promise<AacSymbolAdmin> {
      const index = symbols.findIndex((s) => s.id === id);
      const updated = {
        ...symbols[index]!,
        hasImage: true,
        imageUrl: `/aac/images/${id}?v=1`,
        attribution: {
          license: 'CC BY-SA',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
          author: 'ARASAAC',
          authorUrl: 'https://arasaac.org',
          sourceUrl: 'https://www.opensymbols.org/symbols/os-1',
        },
      };
      symbols[index] = updated;
      return Promise.resolve(updated);
    },
    createAacRelation(parentId: string, childId: string): Promise<AacSymbolAdmin> {
      const parent = symbols.find((s) => s.id === parentId)!;
      const child = symbols.find((s) => s.id === childId)!;
      parent.children = [
        ...parent.children,
        {
          relationId: `rel-${++counter}`,
          relation: 'contains',
          symbol: {
            id: child.id,
            concept: child.concept,
            label: child.label,
            category: child.category,
            glyph: child.glyph,
            synonyms: child.synonyms,
            isNew: child.isNew,
            imageUrl: child.imageUrl,
            attribution: child.attribution,
          },
        },
      ];
      return Promise.resolve(parent);
    },
    deleteAacRelation(): Promise<void> {
      return Promise.resolve();
    },
    // Worker-tokenbeheer (T5.8) heeft een eigen test; hier alleen stubs zodat de volledige `Api` compileert.
    listWorkerTokens() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'stub'));
    },
    createWorkerToken() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'stub'));
    },
    revokeWorkerToken() {
      return Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'stub'));
    },
    listPersonalContext: notImplemented,
    createPersonalContext: notImplemented,
    updatePersonalContext: notImplemented,
    deletePersonalContext: () => Promise.resolve(),
    listPreferences: () => Promise.resolve({ preferences: [] }),
    resolveSuggestion: notImplemented,
    searchAac: () => Promise.resolve({ symbols: [] }),
    listQuestionUsers: () => Promise.resolve({ users: [] }),
    startQuestion: notImplemented,
    viewUserConversation: notImplemented,
    getDashboard: notImplemented,
    listAuditLogs: notImplemented,
    listAiConversations: notImplemented,
    getAiConversation: notImplemented,
    listCaregiverMessages: notImplemented,
    acknowledgeCaregiverMessage: notImplemented,
    unacknowledgeCaregiverMessage: notImplemented,
    listConversations: notImplemented,
    getConversation: notImplemented,
    listOperatorOrganizations: notImplemented,
    createOperatorOrganization: notImplemented,
    getOperatorOrganization: notImplemented,
    deactivateOperatorOrganization: notImplemented,
    activateOperatorOrganization: notImplemented,
    listConceptProposals: () => Promise.resolve({ proposals: [] }),
    approveConceptProposal: notImplemented,
    rejectConceptProposal: notImplemented,
    exportProfile: notImplemented,
    importProfile: notImplemented,
    listAacTopics: notImplemented,
    getAiStatus: notImplemented,
    listAiJobs: notImplemented,
    listAiConcepts: notImplemented,
    keepAiConcept: notImplemented,
    mergeAiConcept: notImplemented,
    discardAiConcept: notImplemented,
  };
}

function renderPage(api: Api = fakeApi()) {
  return render(
    <AacLibraryPage api={api} account={adminAccount} onLogout={() => {}} onNavigate={() => {}} />,
  );
}

describe('AAC-bibliotheekbeheer', () => {
  it('toont de bestaande symbolen', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Wandelen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buiten' })).toBeTruthy();
  });

  it('opent een symbool op zijn eigen scherm en gaat terug naar het overzicht (T17.3)', async () => {
    renderPage();

    // Het overzicht is een tegelraster: pictogram, label en waar het over gaat.
    const grid = await screen.findByRole('region', { name: 'Symbolen' });
    const tile = within(grid).getByRole('button', { name: 'Wandelen' });
    expect(tile.textContent).toContain('walking');

    fireEvent.click(tile);

    // Eigen scherm: bewerken, pictogram en relaties bij elkaar, plus verwijderen apart onderaan.
    expect(await screen.findByRole('heading', { level: 1, name: 'Wandelen' })).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Wijzigingen opslaan' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Relaties voor Wandelen' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Symbool Wandelen verwijderen' })).toBeTruthy();
    // Het aanmaakformulier staat niet meer permanent naast de bibliotheek.
    expect(screen.queryByRole('form', { name: 'Toevoegen' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Alle symbolen' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'AAC-bibliotheek' })).toBeTruthy();
  });

  it('voegt een symbool met relatie toe en vindt het terug via zoeken', async () => {
    const api = fakeApi();
    renderPage(api);
    await screen.findByRole('button', { name: 'Wandelen' });

    // Nieuw symbool aanmaken: het formulier zit sinds T17.3 achter "Symbool toevoegen".
    fireEvent.click(screen.getByRole('button', { name: 'Symbool toevoegen' }));
    const createForm = within(
      await screen.findByRole('dialog', { name: 'Nieuw symbool' }),
    ).getByRole('form', { name: 'Toevoegen' });
    fireEvent.change(within(createForm).getByLabelText('Concept (sleutel)'), {
      target: { value: 'reading' },
    });
    fireEvent.change(within(createForm).getByLabelText('Label (weergavetekst)'), {
      target: { value: 'Lezen' },
    });
    fireEvent.change(within(createForm).getByLabelText('Glyph (emoji-fallback)'), {
      target: { value: '📖' },
    });
    fireEvent.change(within(createForm).getByLabelText('Synoniemen (komma-gescheiden)'), {
      target: { value: 'boek lezen' },
    });
    fireEvent.click(within(createForm).getByRole('button', { name: 'Toevoegen' }));

    // De dialoog sluit en het nieuwe symbool krijgt meteen zijn eigen scherm (T17.3).
    expect(await screen.findByRole('form', { name: 'Wijzigingen opslaan' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    // Relatie leggen: het nieuwe symbool "Lezen" als onderliggend concept.
    const relationForm = screen.getByRole('form', { name: 'Relatie toevoegen' });
    // Selecteer een kandidaat (bv. Buiten) en voeg toe.
    const select = within(relationForm).getByLabelText('Onderliggend concept');
    const option = within(select).getByRole('option', { name: /Buiten/ });
    fireEvent.change(select, { target: { value: (option as HTMLOptionElement).value } });
    fireEvent.click(within(relationForm).getByRole('button', { name: 'Relatie toevoegen' }));

    // De relatie verschijnt in de relatielijst.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Relatie met Buiten verwijderen' })).toBeTruthy(),
    );

    // Terugvinden via zoeken op synoniem — dat staat op het overzicht.
    fireEvent.click(screen.getByRole('button', { name: 'Alle symbolen' }));
    fireEvent.change(await screen.findByLabelText('Zoekterm'), { target: { value: 'boek' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zoeken' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Lezen' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Wandelen' })).toBeNull();
    });
  });

  it('toont een fout bij een dubbel concept', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Wandelen' });

    fireEvent.click(screen.getByRole('button', { name: 'Symbool toevoegen' }));
    const createForm = within(
      await screen.findByRole('dialog', { name: 'Nieuw symbool' }),
    ).getByRole('form', { name: 'Toevoegen' });
    fireEvent.change(within(createForm).getByLabelText('Concept (sleutel)'), {
      target: { value: 'walking' },
    });
    fireEvent.change(within(createForm).getByLabelText('Label (weergavetekst)'), {
      target: { value: 'Wandelen' },
    });
    fireEvent.change(within(createForm).getByLabelText('Glyph (emoji-fallback)'), {
      target: { value: '🚶' },
    });
    fireEvent.click(within(createForm).getByRole('button', { name: 'Toevoegen' }));

    expect((await within(createForm).findByRole('alert')).textContent).toContain('bestaat al');
  });

  it('uploadt een afbeelding voor een geselecteerd symbool', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Wandelen' }));

    const imagePanel = await screen.findByRole('region', { name: 'Afbeelding voor Wandelen' });
    expect(within(imagePanel).getByText(/Nog geen afbeelding/)).toBeTruthy();

    const input = within(imagePanel).getByLabelText(/Afbeelding uploaden/);
    const file = new File(['bytes'], 'pictogram.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Afbeelding voor Wandelen' })).getByText(
          /Er is een afbeelding geüpload/,
        ),
      ).toBeTruthy(),
    );
  });

  it('toont een fout als de upload wordt geweigerd', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Wandelen' }));

    const imagePanel = await screen.findByRole('region', { name: 'Afbeelding voor Wandelen' });
    const input = within(imagePanel).getByLabelText(/Afbeelding uploaden/);
    const bad = new File(['x'], 'note.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [bad] } });

    expect((await within(imagePanel).findByRole('alert')).textContent).toContain(
      'Alleen afbeeldingen',
    );
  });

  it('zoekt in OpenSymbols en koppelt een resultaat met bronvermelding', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Wandelen' }));

    const panel = await screen.findByRole('region', { name: 'OpenSymbols zoeken voor Wandelen' });
    // De zoekterm is voorgevuld met het label; gewoon zoeken.
    fireEvent.click(within(panel).getByRole('button', { name: 'Zoek pictogram' }));

    const attach = await within(panel).findByRole('button', {
      name: /Koppel .* aan Wandelen/,
    });
    fireEvent.click(attach);

    // Na koppelen toont het pictogram-paneel de bronvermelding en licentie.
    await waitFor(() => {
      const imagePanel = screen.getByRole('region', { name: 'Afbeelding voor Wandelen' });
      expect(within(imagePanel).getByText(/ARASAAC/)).toBeTruthy();
      expect(within(imagePanel).getByText(/CC BY-SA/)).toBeTruthy();
    });
  });

  it('toont een lege-resultatenmelding bij OpenSymbols', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Wandelen' }));

    const panel = await screen.findByRole('region', { name: 'OpenSymbols zoeken voor Wandelen' });
    fireEvent.change(within(panel).getByLabelText('OpenSymbols-zoekterm'), {
      target: { value: 'leeg' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Zoek pictogram' }));

    expect(await within(panel).findByText('Geen resultaten gevonden.')).toBeTruthy();
  });
});
