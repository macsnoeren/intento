import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AnswerRequest, CommunicationTurn, TabletPresentation } from '@intento/shared';
import { TabletConversation } from './TabletConversation.tsx';
import { ApiRequestError, type DeviceApi } from './api.ts';
import type { SpeechPort } from './speech.ts';

/** Tablet: "Wil je dit sturen?", de contactvraag en "Verstuurd" (N11.4, INTENTO-NEW-DESIGN §48). */

function turnOf(
  turn: number,
  presentation: TabletPresentation,
  extra: Partial<CommunicationTurn> = {},
): CommunicationTurn {
  return { sessionId: 's-1', turn, canGoBack: true, delivery: null, presentation, ...extra };
}

const ASK = turnOf(3, {
  kind: 'share_ask',
  mode: 'binary',
  text: 'Wil je dit sturen?',
  message: 'Ik heb hoofdpijn.',
  options: [],
});

const MAMA = turnOf(4, {
  kind: 'share_contact',
  mode: 'binary',
  text: 'Wil je dit naar Mama sturen?',
  message: 'Ik heb hoofdpijn.',
  options: [
    {
      ref: 'contact-c-mama',
      kind: 'contact',
      label: 'Mama',
      imageUrl: '/assets/v-mother?exp=1&sig=x',
      representation: 'exact',
      position: 0,
    },
  ],
});

function done(delivery: CommunicationTurn['delivery']): CommunicationTurn {
  return turnOf(
    5,
    {
      kind: 'done',
      mode: 'binary',
      text: 'Ik heb hoofdpijn.',
      message: 'Ik heb hoofdpijn.',
      options: [],
    },
    { canGoBack: false, delivery },
  );
}

/** Een tablet die bij elk antwoord het volgende scherm uit `script` geeft; begint bij `resume`. */
function scripted(resume: CommunicationTurn, script: CommunicationTurn[]) {
  const answers: AnswerRequest[] = [];
  const queue = [...script];
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const api = {
    ...(new Proxy({}, { get: () => notImplemented }) as DeviceApi),
    currentConversation: () => Promise.resolve(resume),
    answerConversation(_sessionId: string, answer: AnswerRequest) {
      answers.push(answer);
      const next = queue.shift();
      return next ? Promise.resolve(next) : notImplemented();
    },
  } satisfies DeviceApi;
  return { api, answers };
}

function recorder(): SpeechPort & { said: string[] } {
  const said: string[] = [];
  return {
    said,
    speak: (text) => said.push(...(typeof text === 'string' ? [text] : text)),
    stop: () => {},
    unlock: () => {},
  };
}

function renderTablet(api: DeviceApi, speech: SpeechPort = recorder(), speaks = false): void {
  render(<TabletConversation api={api} showText speech={speech} speaks={speaks} />);
}

describe('delen op de tablet', () => {
  it('"Wil je dit sturen?" toont eerst de boodschap groot, en leest beide voor', async () => {
    const speech = recorder();
    const { api } = scripted(ASK, []);
    renderTablet(api, speech, true);
    expect(await screen.findByRole('heading', { name: 'Wil je dit sturen?' })).toBeTruthy();
    expect(screen.getByText('Ik heb hoofdpijn.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '↩ Terug' })).toBeTruthy();
    await waitFor(() => expect(speech.said).toEqual(['Ik heb hoofdpijn. Wil je dit sturen?']));
    fireEvent.click(screen.getByRole('button', { name: '🔊 Nog eens' }));
    expect(speech.said.at(-1)).toBe('Ik heb hoofdpijn.');
  });

  it('de contactvraag: pictogram en naam, JA/NEE', async () => {
    const { api, answers } = scripted(MAMA, [done({ contactName: 'Mama', status: 'sent' })]);
    renderTablet(api);
    expect(
      await screen.findByRole('heading', { name: 'Wil je dit naar Mama sturen?' }),
    ).toBeTruthy();
    expect(screen.getByText('Mama')).toBeTruthy();
    expect(document.querySelector('img.pictogram__image')?.getAttribute('src')).toContain(
      'v-mother',
    );
    fireEvent.click(screen.getByRole('button', { name: /JA/ }));
    expect((await screen.findByRole('status')).textContent).toContain('Verstuurd naar Mama');
    expect(answers).toEqual([expect.objectContaining({ turn: 4, answer: 'yes' })]);
    // Na een verzending is er geen Terug meer.
    expect(screen.queryByRole('button', { name: '↩ Terug' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Nieuw gesprek' })).toBeTruthy();
  });

  it('"Versturen is niet gelukt" als de e-mail niet weg kon', async () => {
    const { api } = scripted(MAMA, [done({ contactName: 'Mama', status: 'failed' })]);
    renderTablet(api);
    fireEvent.click(await screen.findByRole('button', { name: /JA/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Versturen is niet gelukt');
    expect(screen.queryByText(/Verstuurd naar/)).toBeNull();
  });

  it('Klaar zonder verzending: alleen de boodschap', async () => {
    const { api } = scripted(ASK, [done(null)]);
    renderTablet(api);
    fireEvent.click(await screen.findByRole('button', { name: /NEE/ }));
    expect(await screen.findByRole('heading', { name: 'Ik heb hoofdpijn.' })).toBeTruthy();
    expect(screen.queryByText(/Verstuurd/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
