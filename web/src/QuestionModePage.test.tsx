import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AacSymbol, AccountPublic, QuestionStartRequest, UserPublic } from '@intento/shared';
import { QuestionModePage } from './QuestionModePage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor de begeleiderinterface — vraagmodus (T7.1, DESIGN §3.2). Draaien tegen een in-memory
 * `Api`: de begeleider kiest een gekoppelde gebruiker, typt een vraag, zoekt een onderwerp en verstuurt.
 * De backend-isolatie (alleen gekoppelde gebruikers) is server-side gedekt; hier gaat het om de UI-flow.
 */

const caregiver: AccountPublic = {
  id: 'acc-1',
  email: 'begeleider@intento.local',
  role: 'CAREGIVER',
  organizationId: 'org-1',
  name: null,
  emailVerified: true,
  mustChangePassword: false,
  isOperator: false,
};

function user(id: string, name: string): UserPublic {
  return {
    id,
    name,
    organizationId: 'org-1',
    active: true,
    createdAt: '2026-07-12T10:00:00.000Z',
    communicationProfile: {
      iconsPerScreen: 4,
      showText: true,
      aiLearningEnabled: true,
      supportMode: false,
      contextIndicator: true,
      conversationStrategy: 'refine',
    },
  };
}

function sym(concept: string, label: string, glyph: string): AacSymbol {
  return {
    id: concept,
    concept,
    label,
    category: 'drink',
    glyph,
    synonyms: [],
    imageUrl: `/aac/images/${concept}`,
    attribution: null,
    isNew: false,
  };
}

function fakeApi(
  overrides: Partial<
    Pick<
      Api,
      | 'listQuestionUsers'
      | 'searchAac'
      | 'listAacTopics'
      | 'startQuestion'
      | 'viewUserConversation'
      | 'getAiStatus'
    >
  > = {},
): Api {
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return {
    ...base,
    listQuestionUsers: () => Promise.resolve({ users: [user('u-1', 'Sanne')] }),
    searchAac: () => Promise.resolve({ symbols: [sym('drink', 'Drinken', '🥤')] }),
    // Onderwerpen met antwoordopties (T9.7) en de AI-statusindicator (T9.4) worden bij het openen
    // opgehaald; expliciet meegeven, want de spread hierboven kopieert de Proxy-methodes niet.
    listAacTopics: () => Promise.resolve({ topics: [sym('drink', 'Drinken', '🥤')] }),
    // Het meekijkpaneel haalt zichzelf op zodra er een gebruiker gekozen is (T9.3); standaard "geen
    // lopend gesprek", zodat het in tests over de vraagflow geen ruis (of foutmelding) oplevert.
    viewUserConversation: (userId: string) =>
      Promise.resolve({ userId, userName: 'Sanne', supportMode: false, session: null }),
    getAiStatus: () =>
      Promise.resolve({
        mode: 'queue' as const,
        workerRequired: true,
        workersOnline: 1,
        lastSeenAt: '2026-08-21T10:00:00.000Z',
        active: true,
      }),
    startQuestion: notImplemented,
    ...overrides,
  };
}

describe('begeleiderinterface — vraagmodus', () => {
  it('stuurt een vraag met gekozen gebruiker, tekst en onderwerp', async () => {
    const sent: QuestionStartRequest[] = [];
    const api = fakeApi({
      startQuestion: (body) => {
        sent.push(body);
        return Promise.resolve({ sessionId: 's-1', userId: body.userId, question: body.question });
      },
    });
    render(<QuestionModePage api={api} account={caregiver} onLogout={() => {}} />);

    // Gebruiker is geladen en voorgeselecteerd.
    expect(await screen.findByRole('option', { name: 'Sanne' })).toBeTruthy();

    // Vraag typen.
    fireEvent.change(screen.getByLabelText('Vraag'), {
      target: { value: 'Wat wil je drinken?' },
    });

    // Onderwerp zoeken en kiezen.
    fireEvent.change(screen.getByLabelText('Onderwerp zoeken'), { target: { value: 'drinken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zoeken' }));
    fireEvent.click(await screen.findByRole('button', { name: /Drinken/ }));

    // Versturen.
    fireEvent.click(screen.getByRole('button', { name: 'Vraag versturen' }));

    expect((await screen.findByRole('status')).textContent).toContain('Vraag verstuurd naar Sanne');
    expect(sent).toEqual([
      { userId: 'u-1', question: 'Wat wil je drinken?', anchorConcept: 'drink' },
    ]);
  });

  it('meldt netjes wanneer de begeleider aan geen enkele gebruiker gekoppeld is', async () => {
    const api = fakeApi({ listQuestionUsers: () => Promise.resolve({ users: [] }) });
    render(<QuestionModePage api={api} account={caregiver} onLogout={() => {}} />);

    expect(await screen.findByText(/nog niet aan een gebruiker gekoppeld/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Vraag versturen' })).toBeNull();
  });

  it('laat de begeleider read-only meekijken met het gesprek (T7.2, §3.3)', async () => {
    const api = fakeApi({
      viewUserConversation: (userId) =>
        Promise.resolve({
          userId,
          userName: 'Sanne',
          supportMode: true,
          session: {
            sessionId: 's-1',
            status: 'ACTIVE',
            mode: 'question',
            caregiverQuestion: 'Wat wil je drinken?',
            strategy: { key: 'calm' as const, label: 'Rustig en bevestigend' },
            history: [
              { order: 0, question: 'Wat wil je drinken?', symbol: sym('drink', 'Drinken', '🥤') },
            ],
          },
        }),
    });
    render(<QuestionModePage api={api} account={caregiver} onLogout={() => {}} />);
    await screen.findByRole('option', { name: 'Sanne' });

    // Geen klik nodig: het paneel haalt de stand zelf op en ververst daarna automatisch (T9.3).
    // Ondersteuningsmodus-indicator, de eigen vraag en het afgelegde pad verschijnen — read-only.
    expect(await screen.findByText(/Ondersteuningsmodus actief/)).toBeTruthy();
    const watch = screen.getByRole('region', { name: 'Meekijken met het gesprek' });
    expect(within(watch).getByText(/Wat wil je drinken\?/)).toBeTruthy();
    expect(within(watch).getByRole('navigation', { name: 'Gekozen pad' })).toBeTruthy();
    // De begeleider ziet wélke aanpak er draait (T11.6) — het label, niet de parameters.
    expect(within(watch).getByText(/Rustig en bevestigend/)).toBeTruthy();
    // Geen keuze-/bevestigknoppen in de meekijkweergave.
    expect(within(watch).queryByRole('button', { name: /Bevestigen/ })).toBeNull();
  });

  it('meldt netjes wanneer er geen gesprek loopt bij het meekijken', async () => {
    const api = fakeApi({
      viewUserConversation: (userId) =>
        Promise.resolve({ userId, userName: 'Sanne', supportMode: false, session: null }),
    });
    render(<QuestionModePage api={api} account={caregiver} onLogout={() => {}} />);
    await screen.findByRole('option', { name: 'Sanne' });

    expect(await screen.findByText(/geen gesprek/i)).toBeTruthy();
  });

  it('laat het onderwerp uit de lijst kiezen zonder te zoeken (T9.7)', async () => {
    const sent: QuestionStartRequest[] = [];
    const api = fakeApi({
      listAacTopics: () =>
        Promise.resolve({
          topics: [sym('drink', 'Drinken', '🥤'), sym('eat', 'Eten', '🍽️')],
        }),
      startQuestion: (body) => {
        sent.push(body);
        return Promise.resolve({ sessionId: 's-1', userId: body.userId, question: body.question });
      },
    });
    render(<QuestionModePage api={api} account={caregiver} onLogout={() => {}} />);
    await screen.findByRole('option', { name: 'Sanne' });

    // Zolang er iets ontbreekt staat de knop uit — mét uitleg waarom (dat ontbrak vóór T9.7).
    expect(screen.getByRole('button', { name: 'Vraag versturen' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText(/Kies eerst .*een vraag en een onderwerp/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Vraag'), { target: { value: 'Wat wil je drinken?' } });
    fireEvent.change(await screen.findByLabelText('Onderwerp kiezen uit de lijst'), {
      target: { value: 'drink' },
    });

    const send = screen.getByRole('button', { name: 'Vraag versturen' });
    expect(send.hasAttribute('disabled')).toBe(false);
    fireEvent.click(send);

    expect((await screen.findByRole('status')).textContent).toContain('Vraag verstuurd naar Sanne');
    expect(sent).toEqual([
      { userId: 'u-1', question: 'Wat wil je drinken?', anchorConcept: 'drink' },
    ]);
  });

  it('ververst het meekijken vanzelf zodra de gebruiker een keuze maakt (T9.3)', async () => {
    // De nep-backend levert bij de tweede aanroep een verder gevorderd gesprek; de begeleider hoeft
    // daar niets voor te klikken.
    let calls = 0;
    const api = fakeApi({
      viewUserConversation: (userId) => {
        calls += 1;
        return Promise.resolve({
          userId,
          userName: 'Sanne',
          supportMode: false,
          session:
            calls === 1
              ? {
                  sessionId: 's-1',
                  status: 'ACTIVE' as const,
                  mode: 'free' as const,
                  caregiverQuestion: null,
                  strategy: { key: 'refine' as const, label: 'Stap voor stap verfijnen' },
                  history: [],
                }
              : {
                  sessionId: 's-1',
                  status: 'ACTIVE' as const,
                  mode: 'free' as const,
                  caregiverQuestion: null,
                  strategy: { key: 'refine' as const, label: 'Stap voor stap verfijnen' },
                  history: [
                    {
                      order: 0,
                      question: 'Wat wil je duidelijk maken?',
                      symbol: sym('drink', 'Drinken', '🥤'),
                    },
                  ],
                },
        });
      },
    });
    render(<QuestionModePage api={api} account={caregiver} onLogout={() => {}} watchPollMs={20} />);

    const watch = await screen.findByRole('region', { name: 'Meekijken met het gesprek' });
    // Eerste stand: nog geen keuze.
    expect(await within(watch).findByText(/nog geen keuze/i)).toBeTruthy();
    // Zonder één klik verschijnt de nieuwe keuze in het afgelegde pad.
    expect(await within(watch).findByRole('navigation', { name: 'Gekozen pad' })).toBeTruthy();
    expect(within(watch).getByText(/Drinken/)).toBeTruthy();
  });

  it('toont de beheernavigatie wanneer de pagina als beheertab draait (T9.1)', async () => {
    const api = fakeApi();
    const visited: string[] = [];
    render(
      <QuestionModePage
        api={api}
        account={{ ...caregiver, role: 'ADMIN' }}
        onLogout={() => {}}
        onNavigate={(view) => visited.push(view)}
      />,
    );
    await screen.findByRole('option', { name: 'Sanne' });

    const nav = screen.getByRole('navigation', { name: 'Beheer' });
    expect(within(nav).getByRole('button', { name: 'Gebruikers' })).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: 'Gebruikers' }));
    expect(visited).toEqual(['users']);
  });

  it('toont een fout als versturen mislukt', async () => {
    const api = fakeApi({
      startQuestion: () =>
        Promise.reject(new ApiRequestError(403, 'FORBIDDEN', 'Je bent niet gekoppeld.')),
    });
    render(<QuestionModePage api={api} account={caregiver} onLogout={() => {}} />);

    await screen.findByRole('option', { name: 'Sanne' });
    fireEvent.change(screen.getByLabelText('Vraag'), { target: { value: 'Wat wil je drinken?' } });
    fireEvent.change(screen.getByLabelText('Onderwerp zoeken'), { target: { value: 'drinken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zoeken' }));
    fireEvent.click(await screen.findByRole('button', { name: /Drinken/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Vraag versturen' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Je bent niet gekoppeld.');
  });
});
