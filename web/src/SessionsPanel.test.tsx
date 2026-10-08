import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionListResponse, SessionReview } from '@intento/shared';
import type { Api } from './api.ts';
import { SessionsPanel } from './SessionsPanel.tsx';

/** Gesprekken terugzien: overzicht en per beurt Getoond / Gekozen / Gedacht (N14.1, §27). */

afterEach(cleanup);

const LIST: SessionListResponse = {
  items: [
    {
      id: 's-2',
      startedAt: '2026-10-07T10:00:00.000Z',
      endedAt: '2026-10-07T10:02:00.000Z',
      status: 'confirmed',
      screens: 3,
    },
    {
      id: 's-1',
      startedAt: '2026-10-06T09:00:00.000Z',
      endedAt: '2026-10-06T09:01:00.000Z',
      status: 'stopped',
      screens: 1,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 25,
};

const REVIEW: SessionReview = {
  session: {
    id: 's-2',
    user: { id: 'u-1', name: 'Sanne' },
    startedAt: '2026-10-07T10:00:00.000Z',
    endedAt: '2026-10-07T10:02:00.000Z',
    status: 'confirmed',
  },
  turns: [
    {
      turn: 0,
      presented: {
        kind: 'question',
        mode: 'multi',
        text: 'Wat bedoel je?',
        message: null,
        options: [
          {
            ref: 'o-pain',
            kind: 'symbol',
            label: 'pijn',
            concept: 'pain',
            representation: 'exact',
            position: 0,
          },
          {
            ref: 'o-drink',
            kind: 'symbol',
            label: 'drinken',
            concept: 'drink',
            representation: 'stand_in',
            position: 1,
          },
        ],
      },
      observed: [
        { type: 'start', optionRef: null, position: null, responseTimeMs: null },
        { type: 'select_option', optionRef: 'o-drink', position: 1, responseTimeMs: 2100 },
      ],
      inferred: [
        {
          agent: 'intent-agent',
          kind: 'intent_hypotheses',
          payload: { hypotheses: [{ concept: 'drink', label: 'drinken', confidence: 0.6 }] },
          confidence: 0.6,
        },
        {
          agent: 'interaction-strategy',
          kind: 'mode_change',
          payload: {
            from: null,
            to: 'multi',
            reason: 'meerdere pictogrammen leidde vaker tot een bericht',
          },
          confidence: null,
        },
      ],
      decisions: [
        {
          agent: 'intent-agent',
          status: 'fallback',
          model: 'gpt-oss:120b-cloud',
          promptVersion: 'rules-v1',
          latencyMs: 1200,
          validation: 'invalid',
          reason: 'llm: timeout',
        },
      ],
    },
    {
      turn: 1,
      presented: {
        kind: 'done',
        mode: 'binary',
        text: 'Drinken.',
        message: 'Drinken',
        options: [],
      },
      observed: [],
      inferred: [],
      decisions: [],
    },
  ],
};

function fakeApi(): { api: Api; opened: string[] } {
  const opened: string[] = [];
  const api = {
    listUserSessions: () => Promise.resolve(LIST),
    getSessionReview: (id: string) => {
      opened.push(id);
      return Promise.resolve(REVIEW);
    },
  } as Partial<Api> as Api;
  return { api, opened };
}

describe('SessionsPanel', () => {
  it('toont de gesprekken, nieuwste eerst, met status en aantal schermen', async () => {
    render(<SessionsPanel api={fakeApi().api} userId="u-1" userName="Sanne" />);
    const rows = await screen.findAllByRole('button', { name: /oktober/ });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Bevestigd · 3 schermen'),
      expect.stringContaining('Gestopt · 1 scherm'),
    ]);
  });

  it('per beurt Getoond, Gekozen en Gedacht apart, met de agentbeslissingen', async () => {
    const { api, opened } = fakeApi();
    render(<SessionsPanel api={api} userId="u-1" userName="Sanne" />);
    fireEvent.click((await screen.findAllByRole('button', { name: /oktober/ }))[0] as HTMLElement);
    const first = await screen.findByRole('listitem', { name: 'Beurt 0' });
    expect(opened).toEqual(['s-2']);

    const shown = within(first).getByRole('region', { name: 'Getoond' });
    expect(shown.textContent).toContain('Wat bedoel je?');
    expect(shown.textContent).toContain('Vraag · tegels');
    expect(shown.textContent).toContain('drinken (vervanger)');
    const chosen = within(first).getByRole('region', { name: 'Gekozen' });
    expect(chosen.textContent).toContain('Gesprek gestart');
    expect(chosen.textContent).toContain('Koos drinken (plek 2) · 2,1 s');
    const thought = within(first).getByRole('region', { name: 'Gedacht' });
    expect(thought.textContent).toContain('drinken 60%');
    expect(thought.textContent).toContain('Vorm: tegels (meerdere pictogrammen');
    expect(within(first).getByRole('list', { name: 'Agentbeslissingen' }).textContent).toContain(
      'intent-agent: terugval op regels · gpt-oss:120b-cloud (rules-v1) · 1200 ms · llm: timeout',
    );

    const last = screen.getByRole('listitem', { name: 'Beurt 1' });
    expect(within(last).getByRole('region', { name: 'Gekozen' }).textContent).toContain('—');

    fireEvent.click(screen.getByRole('button', { name: /Alle gesprekken/ }));
    expect(await screen.findByRole('region', { name: 'Gesprekken' })).toBeTruthy();
  });

  it('nog geen gesprekken', async () => {
    const api = {
      listUserSessions: () => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 25 }),
    } as Partial<Api> as Api;
    render(<SessionsPanel api={api} userId="u-1" userName="Sanne" />);
    expect(await screen.findByText('Sanne heeft nog geen gesprekken.')).toBeTruthy();
  });
});
