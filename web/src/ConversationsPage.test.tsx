import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  AccountPublic,
  ConversationListResponse,
  ConversationTranscriptResponse,
} from '@intento/shared';
import { ConversationsPage } from './ConversationsPage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor het teruglezen van een gesprek (T12.1). Draaien tegen een in-memory `Api`; de
 * tenant-/begeleidersgrens zit op de server en is daar getest. Wat hier telt: kan een begeleider het
 * verloop lezen zoals de gebruiker het zag — vraag, aanbod, keuze — en is de keuze herkenbaar.
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

const gesprek: ConversationListResponse['conversations'][number] = {
  id: 'sess-1',
  status: 'COMPLETED',
  mode: 'free',
  caregiverQuestion: null,
  strategy: { key: 'refine', label: 'Stap voor stap verfijnen' },
  startedAt: '2026-08-22T09:00:00.000Z',
  stepCount: 2,
  correctionCount: 1,
  message: 'Ik wil brood eten.',
};

const verloop: ConversationTranscriptResponse = {
  ...gesprek,
  steps: [
    {
      order: 0,
      question: 'Wat wil je?',
      chosenConcept: 'want',
      confidence: 0.4,
      at: '2026-08-22T09:00:01.000Z',
      options: [
        {
          concept: 'want',
          label: 'Iets willen',
          glyph: '🎯',
          imageUrl: null,
          isNew: false,
          chosen: true,
          missing: false,
        },
        {
          concept: 'say',
          label: 'Iets zeggen',
          glyph: '💬',
          imageUrl: null,
          isNew: false,
          chosen: false,
          missing: false,
        },
      ],
    },
    {
      order: 1,
      question: 'Wat wil je op je brood?',
      chosenConcept: 'beleg',
      confidence: 0.6,
      at: '2026-08-22T09:00:20.000Z',
      options: [
        {
          concept: 'beleg',
          label: 'Beleg',
          glyph: '🆕',
          imageUrl: null,
          isNew: true,
          chosen: true,
          missing: false,
        },
      ],
    },
  ],
  corrections: [
    { type: 'wrong_guess', stepOrder: 1, rejectedConcept: 'bread', at: '2026-08-22T09:00:15.000Z' },
  ],
};

function fakeApi(overrides: Partial<Api> = {}): Api {
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return {
    ...base,
    listUsers: () =>
      Promise.resolve({
        users: [
          {
            id: 'u-1',
            name: 'Sanne',
            organizationId: 'org-1',
            active: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            communicationProfile: {
              iconsPerScreen: 6,
              showText: true,
              aiLearningEnabled: true,
              supportMode: false,
              contextIndicator: false,
              conversationStrategy: 'refine',
            },
          },
        ],
      }),
    listConversations: () => Promise.resolve({ conversations: [gesprek] }),
    getConversation: () => Promise.resolve(verloop),
    ...overrides,
  };
}

describe('gesprekken-pagina (T12.1)', () => {
  it('toont per stap de vraag, het aanbod en de keuze van de gebruiker', async () => {
    render(
      <ConversationsPage
        api={fakeApi()}
        account={adminAccount}
        onLogout={() => {}}
        onNavigate={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Bekijk' }));

    // De gestelde vragen, in volgorde.
    expect(await screen.findByText('Wat wil je?')).toBeTruthy();
    expect(screen.getByText('Wat wil je op je brood?')).toBeTruthy();
    // Het aanbod dat de gebruiker zag — óók de optie die hij niet koos.
    expect(screen.getByText('Iets zeggen')).toBeTruthy();
    // De keuze is als zodanig herkenbaar (en niet alleen op kleur, zie `.transcript__option--chosen`).
    const gekozen = screen.getByText('Iets willen').closest('li');
    expect(gekozen?.className).toContain('transcript__option--chosen');
    // Een door de AI aangedragen woord blijft ook achteraf als nieuw gemarkeerd.
    expect(screen.getByText('nieuw woord')).toBeTruthy();
    // De correctie staat bij de stap waar hij plaatsvond.
    expect(screen.getByText('❌ Nee — bread teruggerold')).toBeTruthy();
    // De bevestigde boodschap sluit het verloop af (de lijst toont 'm ook, vandaar de afbakening).
    const verloopSectie = screen.getByRole('region', { name: 'Gespreksverloop' });
    expect(within(verloopSectie).getByText('Ik wil brood eten.')).toBeTruthy();
  });

  it('meldt een lege gesprekslijst in plaats van een leeg scherm', async () => {
    render(
      <ConversationsPage
        api={fakeApi({ listConversations: () => Promise.resolve({ conversations: [] }) })}
        account={adminAccount}
        onLogout={() => {}}
        onNavigate={() => {}}
      />,
    );

    expect(
      await screen.findByText('Deze gebruiker heeft nog geen gesprekken gevoerd.'),
    ).toBeTruthy();
  });

  it('toont de foutmelding van de server als het gesprek niet toegankelijk is', async () => {
    // Een begeleider zonder koppeling krijgt 403 van de server; dat is een geldig antwoord en hoort
    // leesbaar op het scherm te komen, niet als leeg verloop.
    render(
      <ConversationsPage
        api={fakeApi({
          getConversation: () =>
            Promise.reject(
              new ApiRequestError(403, 'FORBIDDEN', 'Je hebt geen toegang tot deze resource.'),
            ),
        })}
        account={adminAccount}
        onLogout={() => {}}
        onNavigate={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Bekijk' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('geen toegang'));
  });
});
