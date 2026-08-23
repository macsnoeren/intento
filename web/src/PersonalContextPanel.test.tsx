import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PersonalContextInput, PersonalContextPublic } from '@intento/shared';
import { PersonalContextPanel } from './PersonalContextPanel.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor de persoonlijke-contextwizard (T6.2). Draaien tegen een in-memory `Api`, zodat de
 * begeleiderflow (wizard invullen → afronden → beheren: bewerken/verwijderen) zonder netwerk getest
 * wordt. De AI-invloed van de ingevoerde context is server-side gedekt (§6.3-filter, T6.1/T6.2).
 */

/** Stateful nep-backend met alléén de persoonlijke-context-endpoints ingevuld; de rest werpt. */
function fakeApi(): Api {
  const store: PersonalContextPublic[] = [];
  let counter = 0;
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));

  const contextApi: Pick<
    Api,
    | 'listPersonalContext'
    | 'createPersonalContext'
    | 'updatePersonalContext'
    | 'deletePersonalContext'
  > = {
    listPersonalContext() {
      return Promise.resolve({ contexts: [...store] });
    },
    createPersonalContext(_userId: string, body: PersonalContextInput) {
      const created: PersonalContextPublic = {
        id: `ctx-${++counter}`,
        userId: _userId,
        category: body.category,
        name: body.name,
        relationship: body.relationship ?? null,
        aiUsageAllowed: body.aiUsageAllowed ?? false,
        createdAt: '2026-07-11T10:00:00.000Z',
      };
      store.push(created);
      return Promise.resolve(created);
    },
    updatePersonalContext(_userId: string, contextId: string, body: PersonalContextInput) {
      const index = store.findIndex((c) => c.id === contextId);
      const updated: PersonalContextPublic = {
        ...store[index]!,
        category: body.category,
        name: body.name,
        relationship: body.relationship ?? null,
        aiUsageAllowed: body.aiUsageAllowed ?? false,
      };
      store[index] = updated;
      return Promise.resolve(updated);
    },
    deletePersonalContext(_userId: string, contextId: string) {
      const index = store.findIndex((c) => c.id === contextId);
      if (index >= 0) store.splice(index, 1);
      return Promise.resolve();
    },
  };

  return {
    me: notImplemented,
    login: notImplemented,
    register: notImplemented,
    verifyEmail: notImplemented,
    resendVerification: notImplemented,
    changePassword: notImplemented,
    logout: notImplemented,
    listUsers: notImplemented,
    createUser: notImplemented,
    updateSettings: notImplemented,
    deleteUser: notImplemented,
    createCaregiverAccount: notImplemented,
    listAccounts: notImplemented,
    resetAccountPassword: notImplemented,
    listCaregivers: notImplemented,
    linkCaregiver: notImplemented,
    generateDeviceCode: notImplemented,
    listAacSymbols: notImplemented,
    createAacSymbol: notImplemented,
    updateAacSymbol: notImplemented,
    deleteAacSymbol: notImplemented,
    uploadAacImage: notImplemented,
    createAacRelation: notImplemented,
    deleteAacRelation: notImplemented,
    searchOpenSymbols: notImplemented,
    attachOpenSymbols: notImplemented,
    listWorkerTokens: notImplemented,
    createWorkerToken: notImplemented,
    revokeWorkerToken: notImplemented,
    listPreferences: notImplemented,
    resolveSuggestion: notImplemented,
    searchAac: notImplemented,
    listQuestionUsers: notImplemented,
    startQuestion: notImplemented,
    viewUserConversation: notImplemented,
    getDashboard: notImplemented,
    listAuditLogs: notImplemented,
    listAiConversations: notImplemented,
    getAiConversation: notImplemented,
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
    ...contextApi,
  };
}

function renderPanel(api: Api = fakeApi()) {
  return render(<PersonalContextPanel api={api} userId="u-1" userName="Sanne" />);
}

describe('PersonalContextPanel — wizard (T6.2)', () => {
  it('start bij een lege gebruiker in de wizard en voegt een persoon toe', async () => {
    renderPanel();
    // Lege gebruiker → wizard is het startpunt, eerste stap = personen.
    await screen.findByText('Belangrijke personen');
    expect(screen.getByText('Stap 1 van 5')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Naam'), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByLabelText('Relatie (optioneel)'), {
      target: { value: 'dochter' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Toevoegen' }));

    // Toegevoegd item verschijnt als chip in de huidige stap (met de relatie erbij).
    await screen.findByRole('button', { name: 'Anna verwijderen' });
    expect(screen.getByText('Anna (dochter)', { exact: false })).toBeTruthy();
  });

  it('doorloopt de wizard, rondt af en toont de context in de beheerlijst met bewerken/verwijderen', async () => {
    renderPanel();
    await screen.findByText('Belangrijke personen');

    fireEvent.change(screen.getByLabelText('Naam'), { target: { value: 'Anna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Toevoegen' }));
    await screen.findByRole('button', { name: 'Anna verwijderen' });

    // Doorlopen tot de laatste stap en afronden.
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    }
    await screen.findByText('Vaste routines');
    fireEvent.click(screen.getByRole('button', { name: 'Wizard afronden' }));

    // Beheermodus: het item staat er, standaard mét AI-toestemming (wizard-default).
    const list = await screen.findByRole('list');
    expect(within(list).getByText('Anna')).toBeTruthy();
    expect(within(list).getByText(/AI/)).toBeTruthy();

    // Bewerken: naam aanpassen.
    fireEvent.click(screen.getByRole('button', { name: 'Bewerken' }));
    const nameField = screen.getByLabelText('Naam');
    fireEvent.change(nameField, { target: { value: 'Anna de Vries' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    await screen.findByText('Anna de Vries');

    // Verwijderen: item verdwijnt.
    fireEvent.click(screen.getByRole('button', { name: 'Anna de Vries verwijderen' }));
    await waitFor(() =>
      expect(screen.getByText(/Nog geen context|Start de wizard/, { exact: false })).toBeTruthy(),
    );
  });

  it('toont bestaande context meteen in de beheermodus (niet in de wizard)', async () => {
    const api = fakeApi();
    await api.createPersonalContext('u-1', { category: 'PLACE', name: 'Het park' });
    renderPanel(api);

    await screen.findByText('Persoonlijke context');
    expect(screen.getByText('Het park')).toBeTruthy();
    // Beheer, dus geen wizard-stapteller.
    expect(screen.queryByText(/Stap 1 van/)).toBeNull();
  });
});
