import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  AacSymbol,
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

const TREE: Record<string, { prompt: string; options: AacSymbol[] }> = {
  __root__: {
    prompt: 'Wat wil je duidelijk maken?',
    options: [WANT, FEEL, SAY, ASK, PROBLEM],
  },
  want: { prompt: 'Wat wil je?', options: [DO_ACTIVITY, DRINK] },
  'do-activity': { prompt: 'Wat wil je doen?', options: [OUTSIDE] },
  outside: { prompt: '', options: [] }, // eindconcept → done
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

/** Bouwt een stateful nep-tablet-backend; `linked` bepaalt of het apparaat al gekoppeld is. */
function fakeDeviceApi(options: { linked?: boolean; comm?: CommunicationProfile } = {}): DeviceApi {
  const comm = options.comm ?? profile();
  const user = makeUser(comm);
  const deviceSession: DeviceSessionResponse = {
    device: { id: 'd-1', userId: user.id, type: 'tablet', lastActive: user.createdAt },
    user,
  };
  let linked = options.linked ?? false;
  let history: ConversationStep[] = [];
  let status: ConversationStateResponse['status'] = 'ACTIVE';

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
    const question =
      node.options.length > 0 ? { prompt: node.prompt, options: node.options } : null;
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
    startConversation(): Promise<ConversationStateResponse> {
      history = [];
      status = 'ACTIVE';
      return Promise.resolve(buildState());
    },
    conversationNext(_sessionId: string, symbolId: string): Promise<ConversationStateResponse> {
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
    conversationGenerate(): Promise<ConversationGenerateResponse> {
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
    expect(screen.getByRole('button', { name: 'Nee, terug' })).toBeTruthy();

    // Bevestigen → bevestigingsscherm met de boodschap; daarna opnieuw beginnen.
    fireEvent.click(screen.getByRole('button', { name: 'Bevestigen' }));
    expect(await screen.findByRole('heading', { name: 'Boodschap bevestigd' })).toBeTruthy();
    expect(screen.getByText('Ik wil buiten.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw beginnen' }));
    await screen.findByRole('heading', { name: 'Wat wil je duidelijk maken?' });
  });

  it('gaat bij ❌ Nee terug naar de laatste vraag zonder te bevestigen', async () => {
    render(<TabletApp api={fakeDeviceApi({ linked: true })} />);
    await walkToProposal();

    await screen.findByRole('heading', { name: 'Ik wil buiten.' });
    fireEvent.click(screen.getByRole('button', { name: 'Nee, terug' }));

    // Terug naar de laatste vraag ("Wat wil je doen?"), waar "Buiten" opnieuw gekozen kan worden.
    await screen.findByRole('heading', { name: 'Wat wil je doen?' });
    expect(screen.getByRole('button', { name: 'Buiten' })).toBeTruthy();
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
});
