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
  };
}

function fakeApi(
  overrides: Partial<
    Pick<Api, 'listQuestionUsers' | 'searchAac' | 'startQuestion' | 'viewUserConversation'>
  > = {},
): Api {
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return {
    ...base,
    listQuestionUsers: () => Promise.resolve({ users: [user('u-1', 'Sanne')] }),
    searchAac: () => Promise.resolve({ symbols: [sym('drink', 'Drinken', '🥤')] }),
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
            history: [
              { order: 0, question: 'Wat wil je drinken?', symbol: sym('drink', 'Drinken', '🥤') },
            ],
          },
        }),
    });
    render(<QuestionModePage api={api} account={caregiver} onLogout={() => {}} />);
    await screen.findByRole('option', { name: 'Sanne' });

    fireEvent.click(screen.getByRole('button', { name: 'Meekijken' }));

    // Ondersteuningsmodus-indicator, de eigen vraag en het afgelegde pad verschijnen — read-only.
    expect(await screen.findByText(/Ondersteuningsmodus actief/)).toBeTruthy();
    const watch = screen.getByRole('region', { name: 'Meekijken met het gesprek' });
    expect(within(watch).getByText(/Wat wil je drinken\?/)).toBeTruthy();
    expect(within(watch).getByRole('navigation', { name: 'Gekozen pad' })).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: 'Meekijken' }));
    expect(await screen.findByText(/geen gesprek/i)).toBeTruthy();
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
