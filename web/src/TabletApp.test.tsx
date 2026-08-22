import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  AacSymbol,
  AiStatusResponse,
  ConversationConfirmResponse,
  ConversationGenerateResponse,
  CommunicationProfile,
  ConversationStateResponse,
  ConversationStep,
  DeviceSessionResponse,
  UserPublic,
} from '@intento/shared';
import { TabletApp } from './TabletApp.tsx';
import { ApiRequestError, type DeviceApi } from './api.ts';

/**
 * Web-tests voor de gebruikersapp op de tablet (T4.2). Draaien tegen een in-memory `DeviceApi` met
 * een kleine gescripte gesprekstboom, zodat de volledige flow (koppelen → startscherm → keuzescherm
 * → terug) zonder netwerk getest wordt. De echte engine en HTTP-client zijn server-side gedekt.
 */

function sym(concept: string, label: string, glyph: string): AacSymbol {
  return {
    id: concept,
    concept,
    label,
    category: 'intent',
    glyph,
    synonyms: [],
    imageUrl: `/aac/images/${concept}`,
    attribution: null,
    isNew: false,
  };
}

// Gescripte boom: root (5 intenties) → want (2 opties) → do-activity (1 optie) → outside (eind).
const WANT = sym('want', 'Iets willen', '🎯');
const FEEL = sym('feel', 'Hoe ik mij voel', '❤️');
const SAY = sym('say', 'Iets zeggen', '🗣');
const ASK = sym('ask', 'Een vraag stellen', '❓');
const PROBLEM = sym('problem', 'Er is iets aan de hand', '🤕');
const DO_ACTIVITY = sym('do-activity', 'Iets doen', '🚶');
const DRINK = sym('drink', 'Iets drinken', '🥤');
const OUTSIDE = sym('outside', 'Buiten', '🌳');
const INSIDE = sym('inside', 'Binnen', '🏠');

const TREE: Record<string, { prompt: string; options: AacSymbol[] }> = {
  __root__: {
    prompt: 'Wat wil je duidelijk maken?',
    options: [WANT, FEEL, SAY, ASK, PROBLEM],
  },
  want: { prompt: 'Wat wil je?', options: [DO_ACTIVITY, DRINK] },
  'do-activity': { prompt: 'Wat wil je doen?', options: [OUTSIDE, INSIDE] },
  outside: { prompt: '', options: [] }, // eindconcept → done
  inside: { prompt: '', options: [] }, // eindconcept → done
  // De overige intenties zijn in deze nep-boom eindconcepten; nodig sinds T9.6, want die zijn nu ook
  // van de tweede optiepagina te kiezen.
  feel: { prompt: '', options: [] },
  say: { prompt: '', options: [] },
  ask: { prompt: '', options: [] },
  problem: { prompt: '', options: [] },
};

function profile(overrides: Partial<CommunicationProfile> = {}): CommunicationProfile {
  return {
    iconsPerScreen: 4,
    showText: true,
    aiLearningEnabled: true,
    supportMode: false,
    contextIndicator: true,
    ...overrides,
  };
}

function makeUser(comm: CommunicationProfile): UserPublic {
  return {
    id: 'u-1',
    name: 'Sanne',
    organizationId: 'org-1',
    active: true,
    createdAt: '2026-07-10T10:00:00.000Z',
    communicationProfile: comm,
  };
}

/** AI-wachtrij-503 (T5.7): de client hoort te wachten en de actie later opnieuw te pollen. */
function busyError(): ApiRequestError {
  return new ApiRequestError(
    503,
    'AI_WORKER_BUSY',
    'Alle AI-workers zijn bezet; de aanvraag staat in de wachtrij.',
    10, // korte retryAfterMs zodat de poll-lus binnen de testtimeout herstelt
    2,
  );
}

/**
 * Bouwt een stateful nep-tablet-backend; `linked` bepaalt of het apparaat al gekoppeld is.
 * `busyNext`/`busyGenerate` laten `/next` resp. `/generate` de eerste N keer een AI-wachtrij-503
 * gooien (T5.7), zodat de wacht- en herstel-flow getest kan worden.
 */
function fakeDeviceApi(
  options: {
    linked?: boolean;
    comm?: CommunicationProfile;
    busyNext?: number;
    busyGenerate?: number;
    /** Een klaarstaande begeleidersvraag (vraagmodus, T7.1); `null`/weggelaten = geen → vrij gesprek. */
    pendingQuestion?: ConversationStateResponse | null;
    /** De AI-status die de indicator toont (T9.4); standaard: één actieve worker. */
    aiStatus?: AiStatusResponse;
  } = {},
): DeviceApi {
  const comm = options.comm ?? profile();
  const user = makeUser(comm);
  const deviceSession: DeviceSessionResponse = {
    device: { id: 'd-1', userId: user.id, type: 'tablet', lastActive: user.createdAt },
    user,
  };
  let linked = options.linked ?? false;
  let history: ConversationStep[] = [];
  let status: ConversationStateResponse['status'] = 'ACTIVE';
  let busyNext = options.busyNext ?? 0;
  let busyGenerate = options.busyGenerate ?? 0;
  // Door een correctie afgewezen concepten (T5.4): worden niet opnieuw als optie aangeboden (§7.5).
  const excluded = new Set<string>();

  function currentKey(): string {
    const last = history[history.length - 1];
    return last ? last.symbol.concept : '__root__';
  }

  // Deterministische sjabloon-zin uit de laatste keuze (de echte generator is server-side gedekt).
  function message(): string {
    const last = history[history.length - 1];
    return last ? `Ik wil ${last.symbol.label.toLowerCase()}.` : 'Ik wil iets duidelijk maken.';
  }

  function buildState(): ConversationStateResponse {
    const node = TREE[currentKey()]!;
    let available = node.options.filter((o) => !excluded.has(o.concept));
    let prompt = node.prompt;
    // Zoals de server (T9.14): een **eindconcept** (geen opties in de boom) betekent klaar, maar een punt
    // waar alles is uitgesloten zoekt een niveau hoger verder in plaats van dood te lopen.
    if (available.length === 0 && node.options.length > 0) {
      const higher = [...history.slice(0, -1).map((step) => step.symbol.concept), '__root__']
        .reverse()
        .map((key) => TREE[key]!)
        .find((candidate) => candidate.options.some((o) => !excluded.has(o.concept)));
      if (higher) {
        available = higher.options.filter((o) => !excluded.has(o.concept));
        prompt = higher.prompt;
      }
    }
    const question = available.length > 0 ? { prompt, options: available } : null;
    return {
      sessionId: 's-1',
      status: 'ACTIVE',
      question,
      done: question === null,
      history: [...history],
    };
  }

  return {
    deviceMe(): Promise<DeviceSessionResponse> {
      return linked
        ? Promise.resolve(deviceSession)
        : Promise.reject(new ApiRequestError(401, 'DEVICE_NOT_LINKED', 'Geen gekoppeld apparaat.'));
    },
    linkDevice(code: string): Promise<DeviceSessionResponse> {
      if (code.trim().toUpperCase() !== 'ABCD2345') {
        return Promise.reject(
          new ApiRequestError(
            400,
            'INVALID_LINK_CODE',
            'Koppelcode ongeldig, verlopen of al gebruikt.',
          ),
        );
      }
      linked = true;
      return Promise.resolve(deviceSession);
    },
    getPendingQuestion() {
      return Promise.resolve({ state: options.pendingQuestion ?? null });
    },
    getAiStatus() {
      return Promise.resolve(
        options.aiStatus ?? {
          mode: 'queue' as const,
          workerRequired: true,
          workersOnline: 1,
          lastSeenAt: new Date().toISOString(),
          active: true,
        },
      );
    },
    startConversation(): Promise<ConversationStateResponse> {
      history = [];
      status = 'ACTIVE';
      excluded.clear();
      return Promise.resolve(buildState());
    },
    conversationNext(_sessionId: string, symbolId: string): Promise<ConversationStateResponse> {
      if (busyNext > 0) {
        busyNext -= 1;
        return Promise.reject(busyError());
      }
      const node = TREE[currentKey()]!;
      const chosen = node.options.find((o) => o.id === symbolId);
      if (!chosen) {
        return Promise.reject(
          new ApiRequestError(400, 'INVALID_CHOICE', 'Deze keuze hoort niet bij de huidige vraag.'),
        );
      }
      history = [...history, { order: history.length, question: node.prompt, symbol: chosen }];
      return Promise.resolve(buildState());
    },
    conversationBack(): Promise<ConversationStateResponse> {
      history = history.slice(0, -1);
      return Promise.resolve(buildState());
    },
    conversationCorrection(
      _sessionId: string,
      type: 'wrong_guess' | 'no_fitting_option' = 'wrong_guess',
    ): Promise<ConversationStateResponse> {
      if (type === 'no_fitting_option') {
        // "Staat er niet bij" (T9.12): niets terugrollen, maar alle nu getoonde opties uitsluiten,
        // zodat er andere opties komen — zoals de server het doet.
        for (const option of TREE[currentKey()]!.options) excluded.add(option.concept);
        return Promise.resolve(buildState());
      }
      // Vereenvoudigde heranalyse: rol de laatste keuze terug en sluit dat concept uit (§7.5). De echte
      // min-confidence-heranalyse is server-side gedekt; hier gaat het om de UI-flow (❌ → hervraag).
      const last = history[history.length - 1];
      if (last) excluded.add(last.symbol.concept);
      history = history.slice(0, -1);
      return Promise.resolve(buildState());
    },
    conversationGenerate(): Promise<ConversationGenerateResponse> {
      if (busyGenerate > 0) {
        busyGenerate -= 1;
        return Promise.reject(busyError());
      }
      // Net als de server: een afgeronde sessie levert 409 (T9.13). Zo valt op als de UI na het
      // bevestigen tóch nog op de oude sessie doorwerkt.
      if (status === 'COMPLETED') {
        return Promise.reject(
          new ApiRequestError(409, 'SESSION_NOT_ACTIVE', 'Dit gesprek is al afgerond.'),
        );
      }
      return Promise.resolve({
        sessionId: 's-1',
        status,
        message: message(),
        confidence: 0.95,
        symbols: history.map((step) => step.symbol),
        history: [...history],
      });
    },
    conversationConfirm(): Promise<ConversationConfirmResponse> {
      const confirmed = message();
      status = 'COMPLETED';
      return Promise.resolve({ sessionId: 's-1', status, message: confirmed });
    },
  };
}

describe('gebruikersapp op de tablet', () => {
  it('toont het koppelscherm wanneer het apparaat nog niet gekoppeld is', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: false })} />);
    expect(await screen.findByRole('button', { name: 'Koppelen' })).toBeTruthy();
  });

  it('koppelt met een geldige code en start daarna direct in de gespreksflow', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: false })} />);
    await screen.findByRole('button', { name: 'Koppelen' });

    fireEvent.change(screen.getByLabelText('Koppelcode'), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Koppelen' }));

    // Startscherm met de intentievraag verschijnt.
    expect(
      await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' }),
    ).toBeTruthy();
  });

  it('toont een fout bij een ongeldige koppelcode', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: false })} />);
    await screen.findByRole('button', { name: 'Koppelen' });

    fireEvent.change(screen.getByLabelText('Koppelcode'), { target: { value: 'FOUTFOUT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Koppelen' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Koppelcode ongeldig');
  });

  it('doorloopt de gescripte flow en herstelt met Terug de vorige opties', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true })} />);

    // Startscherm.
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });

    // Kies "Iets willen" → verfijningsvraag "Wat wil je?" met 2 opties.
    fireEvent.click(screen.getByRole('button', { name: 'Iets willen' }));
    await screen.findByRole('heading', { name: 'Wat wil je?' });
    expect(screen.getByRole('button', { name: 'Iets doen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Iets drinken' })).toBeTruthy();

    // Contextindicator toont het afgelegde pad.
    const path = screen.getByRole('navigation', { name: 'Gekozen pad' });
    expect(within(path).getByText(/Iets willen/)).toBeTruthy();

    // Kies "Iets doen" → "Wat wil je doen?".
    fireEvent.click(screen.getByRole('button', { name: 'Iets doen' }));
    await screen.findByRole('heading', { name: 'Wat wil je doen?' });

    // Terug → herstelt exact de vorige vraag en opties.
    fireEvent.click(screen.getByRole('button', { name: '↩ Terug' }));
    await screen.findByRole('heading', { name: 'Wat wil je?' });
    expect(screen.getByRole('button', { name: 'Iets doen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Iets drinken' })).toBeTruthy();
  });

  /** Loopt de gescripte boom af tot het eindconcept "Buiten" (dan verschijnt het voorstelscherm). */
  async function walkToProposal(): Promise<void> {
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });
    fireEvent.click(screen.getByRole('button', { name: 'Iets willen' }));
    await screen.findByRole('button', { name: 'Iets doen' });
    fireEvent.click(screen.getByRole('button', { name: 'Iets doen' }));
    await screen.findByRole('button', { name: 'Buiten' });
    fireEvent.click(screen.getByRole('button', { name: 'Buiten' }));
  }

  it('stelt bij een eindconcept een boodschap voor, bevestigt en begint opnieuw', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true })} />);
    await walkToProposal();

    // Voorstelscherm: de gegenereerde zin + ✅/❌.
    expect(await screen.findByRole('heading', { name: 'Ik wil buiten.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bevestigen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nee, klopt niet' })).toBeTruthy();

    // Bevestigen → bevestigingsscherm met de boodschap; daarna opnieuw beginnen.
    fireEvent.click(screen.getByRole('button', { name: 'Bevestigen' }));
    expect(await screen.findByRole('heading', { name: 'Boodschap bevestigd' })).toBeTruthy();
    expect(screen.getByText('Ik wil buiten.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw beginnen' }));
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });

    // Geen fout uit de vorige (afgeronde) sessie op het scherm (T9.13): de app riep `/generate` opnieuw
    // aan op de zojuist bevestigde sessie en liet "Dit gesprek is al afgerond." staan.
    expect(screen.queryByText(/al afgerond/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('slaat een punt over als het juiste pictogram er niet bij staat (T9.12)', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true })} />);
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });

    fireEvent.click(screen.getByRole('button', { name: 'Iets willen' }));
    await screen.findByRole('heading', { name: 'Wat wil je?' });
    expect(screen.getByRole('button', { name: 'Iets doen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Iets drinken' })).toBeTruthy();

    // "Staat er niet bij": de getoonde opties verdwijnen, de gemaakte keuze blijft staan.
    fireEvent.click(screen.getByRole('button', { name: '🤷 Staat er niet bij' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Iets doen' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Iets drinken' })).toBeNull();
    // De keuze "Iets willen" staat nog in het afgelegde pad — dit is geen "terug".
    expect(screen.getByRole('navigation', { name: 'Gekozen pad' }).textContent).toContain(
      'Iets willen',
    );
  });

  it('start bij ❌ Nee de correctieflow: gerichte hervraag zonder de afgewezen route', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true })} />);
    await walkToProposal();

    await screen.findByRole('heading', { name: 'Ik wil buiten.' });
    fireEvent.click(screen.getByRole('button', { name: 'Nee, klopt niet' }));

    // Gerichte hervraag op de vermoedelijke foutstap ("Wat wil je doen?") — niet terug naar het begin.
    await screen.findByRole('heading', { name: 'Wat wil je doen?' });
    // De afgewezen route ("Buiten") wordt niet opnieuw aangeboden; het alternatief ("Binnen") wel (§7.5).
    expect(screen.queryByRole('button', { name: 'Buiten' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Binnen' })).toBeTruthy();
  });

  it('begrenst het aantal opties tot iconsPerScreen', async () => {
    render(
      <TabletApp api={fakeDeviceApi({ linked: true, comm: profile({ iconsPerScreen: 2 }) })} />,
    );
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });

    // De root heeft 5 intenties; bij iconsPerScreen=2 zijn er precies 2 keuzeknoppen zichtbaar.
    const group = screen.getByRole('group', { name: 'Wat wil je duidelijk maken?' });
    expect(within(group).getAllByRole('button')).toHaveLength(2);
  });

  it('verbergt tekstlabels wanneer showText uitstaat', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true, comm: profile({ showText: false }) })} />);
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });

    // De knop houdt zijn toegankelijke naam (aria-label), maar toont de zichtbare tekst niet.
    const button = screen.getByRole('button', { name: 'Iets willen' });
    expect(button.textContent).toBe('');
  });

  it('toont een rustige wachtstand bij AI_WORKER_BUSY en herstelt automatisch (T5.7)', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true, busyNext: 1 })} />);
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });

    // Keuze insturen: de eerste /next geeft AI_WORKER_BUSY → rustige wachtstand, geen fout.
    fireEvent.click(screen.getByRole('button', { name: 'Iets willen' }));
    expect((await screen.findByRole('status')).textContent).toContain('Even geduld');
    expect(screen.queryByRole('alert')).toBeNull();

    // Zonder verdere interactie polt de app opnieuw en herstelt naar de volgende vraag.
    await screen.findByRole('heading', { name: 'Wat wil je?' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('wacht op de AI-worker bij het genereren van het voorstel en herstelt (T5.7)', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true, busyGenerate: 1 })} />);
    await walkToProposal();

    // /generate geeft eerst AI_WORKER_BUSY → wachtstand op het voorstelscherm, geen fout.
    expect((await screen.findByRole('status')).textContent).toContain('Even geduld');
    expect(screen.queryByRole('alert')).toBeNull();

    // Daarna komt het voorstel vanzelf.
    expect(await screen.findByRole('heading', { name: 'Ik wil buiten.' })).toBeTruthy();
  });

  it('pakt een klaarstaande begeleidersvraag op en toont die als context (vraagmodus, T7.1)', async () => {
    const DRINK_Q: ConversationStateResponse = {
      sessionId: 'q-1',
      status: 'ACTIVE',
      question: {
        prompt: 'Wat past het best?',
        options: [sym('water', 'Water', '💧'), sym('juice', 'Sap', '🧃')],
      },
      done: false,
      history: [{ order: 0, question: 'Wat wil je drinken?', symbol: DRINK }],
      caregiverQuestion: 'Wat wil je drinken?',
    };
    render(<TabletApp api={fakeDeviceApi({ linked: true, pendingQuestion: DRINK_Q })} />);

    // De begeleidersvraag verschijnt in de gebruikersapp, met de antwoordopties eronder — niet het
    // vrije startscherm met intentie-categorieën.
    expect(await screen.findByText(/Je begeleider vraagt:/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Water' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sap' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Wat wil je duidelijk maken?' })).toBeNull();
  });

  it('toont de ondersteuningsmodus-indicator wanneer supportMode aanstaat (T7.2, §3.3)', async () => {
    render(
      <TabletApp api={fakeDeviceApi({ linked: true, comm: profile({ supportMode: true }) })} />,
    );
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });
    expect(screen.getByText(/Ondersteuningsmodus actief/)).toBeTruthy();

    // Blijft zichtbaar op het voorstelscherm (waar de begeleider het aantikken ondersteunt).
    await walkToProposal();
    await screen.findByRole('heading', { name: 'Ik wil buiten.' });
    expect(screen.getByText(/Ondersteuningsmodus actief/)).toBeTruthy();
  });

  it('toont de ondersteuningsmodus-indicator niet wanneer supportMode uitstaat', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true })} />);
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });
    expect(screen.queryByText(/Ondersteuningsmodus actief/)).toBeNull();
  });

  // T8.5: onder `<StrictMode>` (main.tsx, dev) mount React elk component dubbel
  // (mount → unmount → remount). Een "gemount?"-vlag die alleen in de cleanup op `false` gaat en
  // nooit terug op `true`, blokkeert daarna elke setState → het scherm blijft eeuwig op "Laden…".
  it('toont de eerste vraag ook onder StrictMode (dubbele mount, T8.5)', async () => {
    render(
      <StrictMode>
        <TabletApp api={fakeDeviceApi({ linked: true })} />
      </StrictMode>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' }),
    ).toBeTruthy();
    expect(screen.queryByText('Laden…')).toBeNull();
  });

  // Vervolg op T8.5: na de dubbele mount moet ook de rest van de flow (keuze → volgende vraag)
  // blijven werken; de vlag mag niet halverwege alsnog op `false` blijven staan.
  it('blijft onder StrictMode reageren op een keuze (T8.5)', async () => {
    render(
      <StrictMode>
        <TabletApp api={fakeDeviceApi({ linked: true })} />
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });

    fireEvent.click(screen.getByRole('button', { name: 'Iets willen' }));
    expect(await screen.findByRole('heading', { name: 'Wat wil je?' })).toBeTruthy();
  });

  it('maakt de opties buiten het eerste scherm bereikbaar via "Meer keuzes" (T9.6)', async () => {
    // De root heeft vijf intenties; met `iconsPerScreen: 4` staat de vijfde ("Er is iets aan de hand")
    // op de tweede pagina. Vóór T9.6 werd die simpelweg afgekapt en was hij nooit te kiezen.
    render(<TabletApp api={fakeDeviceApi({ linked: true })} />);
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });

    const group = screen.getByRole('group', { name: 'Wat wil je duidelijk maken?' });
    expect(within(group).getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Er is iets aan de hand' })).toBeNull();

    // Volgende pagina: de resterende optie verschijnt en is gewoon te kiezen.
    fireEvent.click(screen.getByRole('button', { name: '➕ Meer keuzes' }));
    expect(screen.getByRole('button', { name: 'Er is iets aan de hand' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Iets willen' })).toBeNull();

    // Op de laatste pagina loopt de knop terug naar de eerste keuzes.
    fireEvent.click(screen.getByRole('button', { name: '↺ Eerste keuzes' }));
    expect(screen.getByRole('button', { name: 'Iets willen' })).toBeTruthy();
  });

  it('toont geen "Meer keuzes" als alle opties op één scherm passen (T9.6)', async () => {
    render(
      <TabletApp api={fakeDeviceApi({ linked: true, comm: profile({ iconsPerScreen: 8 }) })} />,
    );
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });

    expect(screen.queryByRole('button', { name: /Meer keuzes/ })).toBeNull();
  });

  it('kiest een optie van de tweede pagina en gaat gewoon verder (T9.6)', async () => {
    render(
      <TabletApp api={fakeDeviceApi({ linked: true, comm: profile({ iconsPerScreen: 2 }) })} />,
    );
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });

    // Pagina 1 = [Iets willen, Hoe ik mij voel]; "Iets zeggen" staat op pagina 2.
    fireEvent.click(screen.getByRole('button', { name: '➕ Meer keuzes' }));
    expect(screen.getByRole('button', { name: 'Iets zeggen' })).toBeTruthy();

    // Een keuze van een volgende pagina werkt als elke andere keuze: de route loopt door (hier een
    // eindconcept, dus meteen het voorstelscherm).
    fireEvent.click(screen.getByRole('button', { name: 'Een vraag stellen' }));
    expect(await screen.findByRole('heading', { name: 'Ik wil een vraag stellen.' })).toBeTruthy();
  });

  it('toont dat er geen AI meedenkt wanneer de backend op de mock draait (T9.4)', async () => {
    render(
      <TabletApp
        api={fakeDeviceApi({
          linked: true,
          aiStatus: {
            mode: 'mock',
            workerRequired: false,
            workersOnline: 0,
            lastSeenAt: null,
            active: false,
          },
        })}
      />,
    );
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });
    expect(await screen.findByText('Zonder AI')).toBeTruthy();
  });

  it('toont dat de AI meedenkt zodra er een worker actief is (T9.4)', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true })} />);
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });
    expect(await screen.findByText('AI denkt mee')).toBeTruthy();
  });

  it('verbergt de contextindicator wanneer contextIndicator uitstaat', async () => {
    render(
      <TabletApp
        api={fakeDeviceApi({ linked: true, comm: profile({ contextIndicator: false }) })}
      />,
    );
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });

    // Maak een keuze zodat er een afgelegd pad is; de broodkruimel blijft niettemin verborgen.
    fireEvent.click(screen.getByRole('button', { name: 'Iets willen' }));
    await screen.findByRole('heading', { name: 'Wat wil je?' });
    expect(screen.queryByRole('navigation', { name: 'Gekozen pad' })).toBeNull();
  });

  it('markeert een nieuw woord van de AI zichtbaar (T10.6)', async () => {
    // Een begrip dat de AI aandroeg omdat het nog niet in de bibliotheek stond, hoort herkenbaar te
    // zijn: de gebruiker mag zien dat dit een suggestie is en geen vertrouwd pictogram — hij kiest het
    // nog steeds zelf (DESIGN §7.8).
    const api = fakeDeviceApi({ linked: true });
    const original = api.startConversation.bind(api);
    api.startConversation = async () => {
      const state = await original();
      const nieuw: AacSymbol = {
        ...sym('nagelknipper', 'Nagelknipper', '🆕'),
        category: 'object',
        isNew: true,
      };
      return {
        ...state,
        question: { prompt: 'Wat wil je?', options: [WANT, nieuw] },
      };
    };

    render(<TabletApp api={api} />);

    expect(await screen.findByLabelText('Nagelknipper (nieuw woord)')).toBeTruthy();
    // Een gewoon bibliotheekwoord krijgt die markering niet.
    expect(screen.getByLabelText('Iets willen')).toBeTruthy();
  });
});
