import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountPublic, AiJobSummary } from '@intento/shared';
import { AiActivityPage } from './AiActivityPage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor het AI-activiteitenoverzicht (T9.15). In de gebruikerstest was niet te zien of de AI
 * überhaupt opties bedacht; dit scherm laat per aanvraag zien wat eruit kwam. Getoetst: de keuzes van de
 * AI komen in beeld, het scherm ververst zichzelf, en een niet-platformbeheerder krijgt uitleg i.p.v.
 * een lege lijst.
 */

const admin: AccountPublic = {
  id: 'acc-1',
  email: 'beheer@intento.local',
  role: 'ADMIN',
  organizationId: 'org-1',
  name: null,
  emailVerified: true,
  mustChangePassword: false,
  isOperator: true,
};

function job(overrides: Partial<AiJobSummary> = {}): AiJobSummary {
  return {
    id: 'job-1',
    task: 'select_next_question',
    status: 'SUCCEEDED',
    attempts: 1,
    createdAt: '2026-08-22T09:00:00.000Z',
    durationMs: 1450,
    worker: 'gpu-node-1',
    error: null,
    strategy: 'refine',
    question: 'Waar heb je pijn?',
    options: [
      { concept: 'nail', confidence: 0.82 },
      { concept: 'finger', confidence: 0.41 },
    ],
    reason: 'de vraag ging over nagels knippen',
    confidence: 0.7,
    ...overrides,
  };
}

function fakeApi(overrides: Partial<Pick<Api, 'listAiJobs' | 'getAiStatus'>> = {}): Api {
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return {
    ...base,
    listAiJobs: () => Promise.resolve({ jobs: [job()] }),
    getAiStatus: () =>
      Promise.resolve({
        mode: 'queue' as const,
        workerRequired: true,
        workersOnline: 1,
        lastSeenAt: '2026-08-22T09:00:00.000Z',
        active: true,
      }),
    ...overrides,
  };
}

describe('AI-activiteit (T9.15)', () => {
  it('toont per aanvraag de vraag, de door de AI aangedragen concepten en de reden', async () => {
    render(
      <AiActivityPage
        api={fakeApi()}
        account={admin}
        onLogout={() => {}}
        onNavigate={() => {}}
        pollMs={0}
      />,
    );

    const panel = await screen.findByRole('region', { name: 'Recente AI-aanvragen' });
    expect(within(panel).getByText(/Volgende vraag kiezen/)).toBeTruthy();
    expect(within(panel).getByText(/Waar heb je pijn\?/)).toBeTruthy();
    expect(within(panel).getByText(/nail \(82%\)/)).toBeTruthy();
    expect(within(panel).getByText(/nagels knippen/)).toBeTruthy();
    expect(within(panel).getByText(/gpu-node-1/)).toBeTruthy();
    // Wélke aanpak deze aanvraag voortbracht (T11.6), met het label uit de gedeelde catalogus.
    expect(within(panel).getByText(/aanpak: Stap voor stap verfijnen/)).toBeTruthy();
  });

  it('meldt dat er niets in de wachtrij komt zolang de mock draait', async () => {
    render(
      <AiActivityPage
        api={fakeApi({ listAiJobs: () => Promise.resolve({ jobs: [] }) })}
        account={admin}
        onLogout={() => {}}
        onNavigate={() => {}}
        pollMs={0}
      />,
    );
    expect(await screen.findByText(/Nog geen AI-aanvragen/)).toBeTruthy();
  });

  it('ververst zichzelf zodat een lopend gesprek zichtbaar wordt', async () => {
    let calls = 0;
    render(
      <AiActivityPage
        api={fakeApi({
          listAiJobs: () => {
            calls += 1;
            return Promise.resolve({
              jobs: calls === 1 ? [] : [job({ question: 'Wat wil je drinken?' })],
            });
          },
        })}
        account={admin}
        onLogout={() => {}}
        onNavigate={() => {}}
        pollMs={20}
      />,
    );

    expect(await screen.findByText(/Nog geen AI-aanvragen/)).toBeTruthy();
    // Zonder klik verschijnt de nieuwe aanvraag.
    expect(await screen.findByText(/Wat wil je drinken\?/)).toBeTruthy();
  });

  it('legt uit dat alleen platformbeheer hierbij kan (403)', async () => {
    render(
      <AiActivityPage
        api={fakeApi({
          listAiJobs: () =>
            Promise.reject(
              new ApiRequestError(403, 'NOT_PLATFORM_ADMIN', 'Alleen een platformbeheerder.'),
            ),
        })}
        account={admin}
        onLogout={() => {}}
        onNavigate={() => {}}
        pollMs={0}
      />,
    );

    expect(await screen.findByText(/Alleen een platformbeheerder kan hier meekijken/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Recente AI-aanvragen' })).toBeNull();
    // Geen harde foutmelding: dit is een grens, geen storing.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('kan handmatig verversen', async () => {
    let calls = 0;
    render(
      <AiActivityPage
        api={fakeApi({
          listAiJobs: () => {
            calls += 1;
            return Promise.resolve({ jobs: [job({ question: `ronde ${calls}` })] });
          },
        })}
        account={admin}
        onLogout={() => {}}
        onNavigate={() => {}}
        pollMs={0}
      />,
    );

    expect(await screen.findByText(/ronde 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Nu verversen' }));
    expect(await screen.findByText(/ronde 2/)).toBeTruthy();
  });
});
