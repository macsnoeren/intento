import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  AnswerRequest,
  CommunicationProfile,
  CommunicationTurn,
  DeviceSessionResponse,
  UserPublic,
} from '@intento/shared';
import { TabletApp } from './TabletApp.tsx';
import { ApiRequestError, type DeviceApi } from './api.ts';
import type { SpeechPort } from './speech.ts';

/**
 * Web-tests voor de gebruikersapp op de tablet. Draaien tegen een in-memory `DeviceApi`, zodat
 * koppelen en het gesprek zonder netwerk getest worden: de nep-backend vraagt "Pijn?", "Eten?", …
 * en onthoudt elke aanroep, zodat te controleren is dat JA, NEE, Terug en Stoppen de juiste API
 * aanroepen.
 */

function profile(overrides: Partial<CommunicationProfile> = {}): CommunicationProfile {
  return {
    interactionMode: 'binary',
    optionsPerScreen: 4,
    questionStrategy: 'general_to_specific',
    experienceEnabled: true,
    maxQuestions: 15,
    showText: true,
    speechEnabled: false,
    speechVoice: 'nl_NL-pim-medium',
    ...overrides,
  };
}

function makeUser(name = 'Sanne', comm: CommunicationProfile = profile()): UserPublic {
  return {
    id: 'u-1',
    name,
    organizationId: 'org-1',
    active: true,
    createdAt: '2026-07-10T10:00:00.000Z',
    communicationProfile: comm,
  };
}

function sessionFor(user: UserPublic): DeviceSessionResponse {
  return {
    device: { id: 'd-1', userId: user.id, type: 'tablet', lastActive: user.createdAt },
    user,
  };
}

/** Nep-tablet-backend; `linked` bepaalt of het apparaat al gekoppeld is. Telt de `deviceMe`-aanroepen. */
type Call =
  ['start'] | ['answer', string, AnswerRequest] | ['back', string, number] | ['stop', string];

const WORDS = ['pijn', 'eten', 'drinken'];

function screen0(turn: number, word: string, canGoBack: boolean): CommunicationTurn {
  return {
    sessionId: 's-1',
    turn,
    canGoBack,
    presentation: {
      kind: 'question',
      mode: 'binary',
      text: `${word.charAt(0).toUpperCase()}${word.slice(1)}?`,
      message: null,
      options: [
        {
          ref: `v-${word}`,
          kind: 'symbol',
          label: word,
          imageUrl: `/assets/v-${word}?exp=1&sig=x`,
          representation: 'exact',
          position: 0,
        },
      ],
    },
  };
}

function fakeDeviceApi(
  options: {
    linked?: boolean;
    names?: string[];
    resume?: CommunicationTurn | null;
    failAnswer?: ApiRequestError;
  } = {},
): {
  api: DeviceApi;
  calls: () => number;
  log: Call[];
} {
  const log: Call[] = [];
  const history: CommunicationTurn[] = [];
  let current: CommunicationTurn | null = options.resume ?? null;
  let linked = options.linked ?? false;
  const names = options.names ?? ['Sanne'];
  let calls = 0;
  const show = (turn: CommunicationTurn): CommunicationTurn => {
    current = turn;
    history.push(turn);
    return turn;
  };
  return {
    calls: () => calls,
    log,
    api: {
      startConversation() {
        log.push(['start']);
        return Promise.resolve(show(screen0(0, 'pijn', false)));
      },
      currentConversation() {
        return Promise.resolve(current);
      },
      answerConversation(sessionId, answer) {
        log.push(['answer', sessionId, answer]);
        if (options.failAnswer) return Promise.reject(options.failAnswer);
        const turn = (current?.turn ?? 0) + 1;
        const yes = 'answer' in answer && answer.answer === 'yes';
        const shown = current?.presentation;
        // JA op een vraag → "Bedoel je: …?"; JA daarop → Klaar; NEE → het volgende woord.
        if (yes && shown?.kind === 'confirm_message') {
          const message = shown.message ?? '';
          return Promise.resolve(
            show({
              sessionId,
              turn,
              canGoBack: false,
              presentation: { kind: 'done', mode: 'binary', text: message, message, options: [] },
            }),
          );
        }
        if (yes && shown?.kind === 'question') {
          const word = shown.options[0]?.label ?? 'pijn';
          const message = `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
          return Promise.resolve(
            show({
              sessionId,
              turn,
              canGoBack: true,
              presentation: {
                kind: 'confirm_message',
                mode: 'binary',
                text: `Bedoel je: ${message}?`,
                message,
                options: shown.options,
              },
            }),
          );
        }
        const word = WORDS[turn % WORDS.length] ?? 'pijn';
        return Promise.resolve(show(screen0(turn, word, true)));
      },
      goBack(sessionId, turn) {
        log.push(['back', sessionId, turn]);
        const previous = history.at(-2);
        if (!previous) return Promise.reject(new ApiRequestError(409, 'CANNOT_GO_BACK', 'Nee.'));
        return Promise.resolve(show({ ...previous, turn: turn + 1 }));
      },
      stopConversation(sessionId) {
        log.push(['stop', sessionId]);
        current = null;
        return Promise.resolve();
      },
      deviceMe() {
        calls += 1;
        if (!linked) {
          return Promise.reject(new ApiRequestError(401, 'UNAUTHORIZED', 'Niet gekoppeld.'));
        }
        const name = names[Math.min(calls - 1, names.length - 1)] ?? 'Sanne';
        return Promise.resolve(sessionFor(makeUser(name)));
      },
      linkDevice(code) {
        if (code !== 'ABCD2345') {
          return Promise.reject(new ApiRequestError(400, 'INVALID_CODE', 'Koppelcode ongeldig.'));
        }
        linked = true;
        return Promise.resolve(sessionFor(makeUser(names[0])));
      },
      speakText() {
        return Promise.resolve(new Blob());
      },
      listAttributions() {
        return Promise.resolve({
          sources: [
            {
              sourceName: 'Mulberry Symbols',
              sourceUrl: 'https://globalsymbols.com/symbolsets/mulberry',
              licenseKey: 'CC-BY-SA-4.0',
              licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
              author: 'Steve Lee',
              authorUrl: null,
              requiresAttribution: true,
              items: [{ id: 'v-1', label: 'pijn' }],
            },
          ],
        });
      },
    },
  };
}

describe('gebruikersapp op de tablet', () => {
  it('toont het koppelscherm wanneer het apparaat nog niet gekoppeld is', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: false }).api} />);
    expect(await screen.findByRole('button', { name: 'Koppelen' })).toBeTruthy();
  });

  it('koppelt met een geldige code en toont daarna het startscherm', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: false }).api} />);
    await screen.findByRole('button', { name: 'Koppelen' });

    fireEvent.change(screen.getByLabelText('Koppelcode'), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Koppelen' }));

    expect(await screen.findByRole('button', { name: 'Ik wil iets zeggen' })).toBeTruthy();
    // Eén grote knop om te beginnen, plus de bronnenlink; verder niets.
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual([
      'Ik wil iets zeggen',
      'Bronnen',
    ]);
  });

  it('toont een fout bij een ongeldige koppelcode', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: false }).api} />);
    await screen.findByRole('button', { name: 'Koppelen' });

    fireEvent.change(screen.getByLabelText('Koppelcode'), { target: { value: 'FOUTFOUT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Koppelen' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Koppelcode ongeldig');
  });

  it('zet de naam van de app en van de gebruiker in de kopbalk', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true }).api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ik wil iets zeggen' }));
    await screen.findByRole('heading', { name: 'Pijn?' });

    const header = screen.getByRole('banner');
    expect(within(header).getByText('Intento')).toBeTruthy();
    expect(within(header).getByText('Sanne')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('haalt de sessie opnieuw op zodra de tablet weer op de voorgrond komt', async () => {
    const { api, calls } = fakeDeviceApi({ linked: true, names: ['Sanne', 'Sanne B.'] });
    render(<TabletApp api={api} />);
    await screen.findByText('Sanne');

    fireEvent(document, new Event('visibilitychange'));

    expect(await screen.findByText('Sanne B.')).toBeTruthy();
    await waitFor(() => expect(calls()).toBe(2));
  });

  it('toont via "Bronnen" de bronvermelding en gaat terug (N2.14)', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true }).api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bronnen' }));
    expect(await screen.findByRole('link', { name: 'Mulberry Symbols' })).toBeTruthy();
    expect(screen.getByText('CC BY-SA 4.0')).toBeTruthy();
    expect(screen.getByText('Steve Lee')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '↩ Terug' }));
    expect(await screen.findByRole('button', { name: 'Ik wil iets zeggen' })).toBeTruthy();
  });
});

describe('gesprek op de tablet: start en binary (N4.9)', () => {
  async function started(fake = fakeDeviceApi({ linked: true })) {
    render(<TabletApp api={fake.api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ik wil iets zeggen' }));
    await screen.findByRole('heading', { name: 'Pijn?' });
    return fake;
  }

  it('start met één knop en toont pictogram, vraag, JA links en NEE rechts', async () => {
    const fake = await started();
    expect(fake.log).toEqual([['start']]);
    // Het woord staat eronder, dus het plaatje zelf is decoratief (alt="").
    const image = document.querySelector('img.pictogram__image');
    expect(image?.getAttribute('alt')).toBe('');
    expect(image?.getAttribute('src')).toMatch(/\/assets\/v-pijn\?exp=1&sig=x$/);
    expect(screen.getByText('pijn')).toBeTruthy();
    const answers = screen.getAllByRole('button').map((b) => b.textContent);
    expect(answers.indexOf('✔ JA')).toBeLessThan(answers.indexOf('✖ NEE'));
    // Op het eerste scherm kan Terug niet; Stoppen wel.
    expect(screen.queryByRole('button', { name: '↩ Terug' })).toBeNull();
    expect(screen.getByRole('button', { name: '⏹ Stoppen' })).toBeTruthy();
  });

  it('JA en NEE sturen het antwoord met beurt en reactietijd', async () => {
    const fake = await started();
    fireEvent.click(screen.getByRole('button', { name: 'NEE' }));
    await screen.findByRole('heading', { name: 'Eten?' });
    fireEvent.click(screen.getByRole('button', { name: 'JA' }));
    await screen.findByRole('heading', { name: 'Bedoel je: Eten?' });

    const answers = fake.log.filter((call) => call[0] === 'answer');
    expect(answers.map((call) => [call[1], { ...call[2], responseTimeMs: 0 }])).toEqual([
      ['s-1', { turn: 0, answer: 'no', responseTimeMs: 0 }],
      ['s-1', { turn: 1, answer: 'yes', responseTimeMs: 0 }],
    ]);
    for (const call of answers) {
      const time = call[2].responseTimeMs;
      expect(typeof time === 'number' && time >= 0).toBe(true);
    }
  });

  it('↩ Terug vraagt het vorige scherm op', async () => {
    const fake = await started();
    fireEvent.click(screen.getByRole('button', { name: 'NEE' }));
    await screen.findByRole('heading', { name: 'Eten?' });
    fireEvent.click(screen.getByRole('button', { name: '↩ Terug' }));
    expect(await screen.findByRole('heading', { name: 'Pijn?' })).toBeTruthy();
    expect(fake.log.at(-1)).toEqual(['back', 's-1', 1]);
  });

  it('⏹ Stoppen beëindigt het gesprek en toont het startscherm', async () => {
    const fake = await started();
    fireEvent.click(screen.getByRole('button', { name: '⏹ Stoppen' }));
    expect(await screen.findByRole('button', { name: 'Ik wil iets zeggen' })).toBeTruthy();
    expect(fake.log.at(-1)).toEqual(['stop', 's-1']);
  });

  it('hervat een lopend gesprek na herladen', async () => {
    const fake = fakeDeviceApi({ linked: true, resume: screen0(3, 'eten', true) });
    render(<TabletApp api={fake.api} />);
    expect(await screen.findByRole('heading', { name: 'Eten?' })).toBeTruthy();
    expect(fake.log).toEqual([]);
  });

  it('haalt bij een al beantwoord scherm (409) het actuele scherm op', async () => {
    const fake = fakeDeviceApi({
      linked: true,
      failAnswer: new ApiRequestError(409, 'STALE_TURN', 'Dit scherm is al beantwoord.'),
    });
    await started(fake);
    fireEvent.click(screen.getByRole('button', { name: 'JA' }));
    await waitFor(() => expect(fake.log.filter((call) => call[0] === 'answer')).toHaveLength(1));
    expect(await screen.findByRole('heading', { name: 'Pijn?' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('toont zonder "tekst tonen" geen label, maar wel een alt-tekst', async () => {
    const fake = fakeDeviceApi({ linked: true });
    const original = fake.api.deviceMe.bind(fake.api);
    fake.api.deviceMe = async () => {
      const session = await original();
      return sessionFor(makeUser(session.user.name, profile({ showText: false })));
    };
    await started(fake);
    expect(screen.queryByText('pijn')).toBeNull();
    expect(screen.getByRole('img', { name: 'pijn' })).toBeTruthy();
  });
});

describe('gesprek op de tablet: "Bedoel je …?" en Klaar (N4.11)', () => {
  async function toProposal(fake = fakeDeviceApi({ linked: true })) {
    render(<TabletApp api={fake.api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ik wil iets zeggen' }));
    await screen.findByRole('heading', { name: 'Pijn?' });
    fireEvent.click(screen.getByRole('button', { name: 'JA' }));
    await screen.findByRole('heading', { name: 'Bedoel je: Pijn?' });
    return fake;
  }

  it('toont het voorstel met pictogram, de vraag en JA/NEE, Terug en Stoppen', async () => {
    await toProposal();
    expect(document.querySelectorAll('.proposal img.pictogram__image')).toHaveLength(1);
    expect(screen.getByText('pijn')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'JA' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'NEE' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '↩ Terug' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '⏹ Stoppen' })).toBeTruthy();
  });

  it('JA toont Klaar met de boodschap groot; Nieuw gesprek begint opnieuw', async () => {
    const fake = await toProposal();
    fireEvent.click(screen.getByRole('button', { name: 'JA' }));
    expect(await screen.findByRole('heading', { name: 'Pijn', level: 1 })).toBeTruthy();
    expect(fake.log.at(-1)).toEqual([
      'answer',
      's-1',
      expect.objectContaining({ turn: 1, answer: 'yes' }),
    ]);
    // Klaar is het einde: geen JA/NEE, geen Terug.
    expect(screen.queryByRole('button', { name: 'JA' })).toBeNull();
    expect(screen.queryByRole('button', { name: '↩ Terug' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Nieuw gesprek' }));
    expect(await screen.findByRole('heading', { name: 'Pijn?' })).toBeTruthy();
    expect(fake.log.filter((call) => call[0] === 'start')).toHaveLength(2);
  });

  it('NEE op het voorstel gaat verder met vragen', async () => {
    const fake = await toProposal();
    fireEvent.click(screen.getByRole('button', { name: 'NEE' }));
    expect(await screen.findByRole('heading', { name: 'Drinken?' })).toBeTruthy();
    expect(fake.log.at(-1)).toEqual([
      'answer',
      's-1',
      expect.objectContaining({ turn: 1, answer: 'no' }),
    ]);
  });
});

describe('voorlezen (N4.12)', () => {
  function recordingSpeech(): { port: SpeechPort; spoken: string[]; unlocks: () => number } {
    const spoken: string[] = [];
    let unlocks = 0;
    return {
      spoken,
      unlocks: () => unlocks,
      port: {
        speak: (text) => {
          spoken.push(...(typeof text === 'string' ? [text] : text));
        },
        stop: () => {},
        unlock: () => {
          unlocks += 1;
        },
      },
    };
  }

  function withSpeech(enabled: boolean) {
    const fake = fakeDeviceApi({ linked: true });
    fake.api.deviceMe = () =>
      Promise.resolve(sessionFor(makeUser('Sanne', profile({ speechEnabled: enabled }))));
    return fake;
  }

  it('spreekt precies de schermtekst en op Klaar de boodschap, met "Nog eens"', async () => {
    const speech = recordingSpeech();
    render(<TabletApp api={withSpeech(true).api} speech={speech.port} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ik wil iets zeggen' }));
    await screen.findByRole('heading', { name: 'Pijn?' });
    expect(speech.unlocks()).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'JA' }));
    await screen.findByRole('heading', { name: 'Bedoel je: Pijn?' });
    fireEvent.click(screen.getByRole('button', { name: 'JA' }));
    await screen.findByRole('heading', { name: 'Pijn', level: 1 });
    await waitFor(() => expect(speech.spoken).toEqual(['Pijn?', 'Bedoel je: Pijn?', 'Pijn']));

    fireEvent.click(screen.getByRole('button', { name: '🔊 Nog eens' }));
    expect(speech.spoken.at(-1)).toBe('Pijn');
  });

  it('zwijgt als voorlezen uit staat', async () => {
    const speech = recordingSpeech();
    render(<TabletApp api={withSpeech(false).api} speech={speech.port} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ik wil iets zeggen' }));
    await screen.findByRole('heading', { name: 'Pijn?' });
    fireEvent.click(screen.getByRole('button', { name: 'JA' }));
    fireEvent.click(await screen.findByRole('button', { name: 'JA' }));
    await screen.findByRole('heading', { name: 'Pijn', level: 1 });
    expect(speech.spoken).toEqual([]);
    expect(screen.queryByRole('button', { name: '🔊 Nog eens' })).toBeNull();
  });
});
