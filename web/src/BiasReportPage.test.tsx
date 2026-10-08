import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountPublic, BiasReport, BiasReportQuery, UserPublic } from '@intento/shared';
import { BiasReportPage } from './BiasReportPage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/** Bias-rapport (N14.3, INTENTO-NEW-DESIGN §24 B4/B5). */

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

const REPORT: BiasReport = {
  sessions: 12,
  firstPosition: { count: 8, of: 13, share: 8 / 13, expected: 0.25 },
  binaryYes: { count: 14, of: 20, share: 0.7 },
  contacts: [
    { contactId: 'c-mama', name: 'Mama', chosen: 5, chosenAtFirst: 4 },
    { contactId: 'c-weg', name: null, chosen: 1, chosenAtFirst: 0 },
  ],
  contactFirst: { count: 4, of: 6, share: 4 / 6 },
  modeSwitches: { switches: 2, sessions: 1 },
  gaps: { open: 3, total: 5 },
  overconfidence: {
    rejectedConfidentProposals: { count: 1, of: 4, share: 0.25 },
    suddenRises: 2,
  },
};

const sanne = { id: 'u-1', name: 'Sanne' } as UserPublic;

function fakeApi(): { api: Api; queries: BiasReportQuery[] } {
  const queries: BiasReportQuery[] = [];
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return {
    queries,
    api: {
      ...base,
      listUsers: () => Promise.resolve({ users: [sanne] }),
      getBiasReport(query = {}) {
        queries.push(query);
        return Promise.resolve(REPORT);
      },
      getVocabularyGapCount: () => Promise.resolve({ open: 0 }),
    },
  };
}

function renderPage(api: Api) {
  render(<BiasReportPage api={api} account={admin} onLogout={() => {}} onNavigate={() => {}} />);
}

describe('BiasReportPage', () => {
  it('toont elk getal met wat het kan betekenen', async () => {
    renderPage(fakeApi().api);
    const report = await screen.findByRole('region', { name: 'Bias-rapport' });
    expect(within(report).getByRole('status').textContent).toBe('Over 12 gesprekken.');
    const text = report.textContent ?? '';
    expect(text).toContain('62% (8 van 13 keuzes) · bij toeval ongeveer 25%');
    expect(text).toContain('70% (14 van 20 antwoorden)');
    expect(text).toContain('67% (4 van 6 verzendingen)');
    expect(within(report).getByRole('list', { name: 'Per contact' }).textContent).toContain(
      'Mama: 5 keer gekozen, waarvan 4 keer als eerste aangeboden',
    );
    expect(text).toContain('Verwijderd contact');
    expect(text).toContain('2 wissels in 1 gesprek');
    expect(text).toContain('3 open van 5');
    expect(text).toContain('1 van 4 voorstellen met 90% zekerheid of meer kregen NEE');
    expect(text).toContain('2 keer steeg de zekerheid plots zonder JA');
  });

  it('filtert op periode en gebruiker', async () => {
    const { api, queries } = fakeApi();
    renderPage(api);
    await screen.findByRole('region', { name: 'Bias-rapport' });
    fireEvent.change(screen.getByLabelText('Periode'), { target: { value: '30' } });
    await screen.findByRole('option', { name: 'Sanne' });
    fireEvent.change(screen.getByLabelText('Gebruiker'), { target: { value: 'u-1' } });
    await waitFor(() => expect(queries.at(-1)).toEqual({ days: 30, userId: 'u-1' }));
    expect(queries[0]).toEqual({});
  });

  it('niets te tellen', async () => {
    const empty: BiasReport = {
      ...REPORT,
      sessions: 1,
      firstPosition: { count: 0, of: 0, share: null, expected: null },
      overconfidence: {
        rejectedConfidentProposals: { count: 0, of: 0, share: null },
        suddenRises: 0,
      },
    };
    const { api } = fakeApi();
    renderPage({ ...api, getBiasReport: () => Promise.resolve(empty) });
    const report = await screen.findByRole('region', { name: 'Bias-rapport' });
    expect(report.textContent).toContain('Nog niets te tellen.');
    expect(report.textContent).toContain('Geen voorstellen met 90% zekerheid of meer.');
    expect(within(report).getByRole('status').textContent).toBe('Over 1 gesprek.');
  });
});
