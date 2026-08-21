import { describe, expect, it } from 'vitest';
import {
  AAC_RULES,
  GOAL,
  MESSAGE_AAC_RULES,
  MESSAGE_GOAL,
  SYSTEM_RULES,
  buildAiPrompt,
  buildMessagePrompt,
  renderMessagePromptText,
  renderPromptText,
} from './prompt.js';
import { AI_TASK_GENERATE_MESSAGE, AI_TASK_SELECT_NEXT_QUESTION } from './provider.js';

/**
 * T5.1-kernacceptatie: de prompt bevat **aantoonbaar alléén toegestane context**. We toetsen de
 * gesloten sleutelset, de afwezigheid van chatgeschiedenis, en dat gesprekscontext/opties puur
 * AAC-concepten zijn (geen vrije tekst/PII).
 */
describe('buildAiPrompt — beperkte context (DESIGN §7.7)', () => {
  const want = { concept: 'want', label: 'Iets willen' };
  const doActivity = { concept: 'do-activity', label: 'Iets doen' };
  const outside = { concept: 'outside', label: 'Buiten' };

  it('heeft precies de toegestane sleutelset (geen chatgeschiedenis, geen extra velden)', () => {
    const prompt = buildAiPrompt({
      conversationContext: [want],
      availableSymbols: [doActivity, outside],
    });

    expect(Object.keys(prompt).sort()).toEqual(
      [
        'aacRules',
        'availableSymbols',
        'conversationContext',
        'goal',
        'lastChoice',
        'questionContext',
        'systemRules',
        'task',
        'userContext',
      ].sort(),
    );
    // Expliciet: geen chat-/berichtenlog en geen vrije-invoervelden.
    expect(prompt).not.toHaveProperty('history');
    expect(prompt).not.toHaveProperty('messages');
    expect(prompt).not.toHaveProperty('chat');
  });

  it('draagt de vaste systeemregels, het doel en de AAC-regels mee', () => {
    const prompt = buildAiPrompt({ conversationContext: [], availableSymbols: [want] });
    expect(prompt.task).toBe(AI_TASK_SELECT_NEXT_QUESTION);
    expect(prompt.systemRules).toEqual([...SYSTEM_RULES]);
    expect(prompt.goal).toBe(GOAL);
    // De vraag moet in het Nederlands aan de gebruiker gesteld worden (T9.16): bij de rooktest met een
    // echte AI kwam er "Is the pain related to being sick?" op de tablet te staan.
    expect(prompt.goal).toContain('Nederlands');
    expect(prompt.aacRules).toEqual([...AAC_RULES]);
  });

  it('leidt de laatste keuze af uit de gesprekscontext', () => {
    const empty = buildAiPrompt({ conversationContext: [], availableSymbols: [want] });
    expect(empty.lastChoice).toBeNull();

    const withSteps = buildAiPrompt({
      conversationContext: [want, doActivity],
      availableSymbols: [outside],
    });
    expect(withSteps.lastChoice).toEqual(doActivity);
  });

  it('gebruikerscontext is standaard leeg (geen ongevraagde PII in de prompt)', () => {
    const prompt = buildAiPrompt({ conversationContext: [want], availableSymbols: [outside] });
    expect(prompt.userContext).toEqual([]);
  });

  it('neemt alléén meegegeven, toegestane gebruikerscontext op', () => {
    const prompt = buildAiPrompt({
      conversationContext: [want],
      availableSymbols: [outside],
      userContext: [{ kind: 'favorite', value: 'hond' }],
    });
    expect(prompt.userContext).toEqual([{ kind: 'favorite', value: 'hond' }]);
  });

  it('gesprekscontext en opties bevatten uitsluitend concept + label (geen vrije velden)', () => {
    const prompt = buildAiPrompt({
      conversationContext: [want],
      availableSymbols: [doActivity, outside],
    });
    for (const ref of [...prompt.conversationContext, ...prompt.availableSymbols]) {
      expect(Object.keys(ref).sort()).toEqual(['concept', 'label']);
    }
  });

  it('begeleidersvraag (vraagmodus) is standaard null en wordt anders letterlijk meegedragen (T7.1)', () => {
    const free = buildAiPrompt({ conversationContext: [want], availableSymbols: [outside] });
    expect(free.questionContext).toBeNull();

    const asked = buildAiPrompt({
      conversationContext: [want],
      availableSymbols: [outside],
      questionContext: 'Wat wil je drinken?',
    });
    expect(asked.questionContext).toBe('Wat wil je drinken?');
  });
});

describe('buildMessagePrompt — beperkte context voor boodschapgeneratie (T5.3, §7.7/§7.8)', () => {
  const want = { concept: 'want', label: 'Iets willen' };
  const outside = { concept: 'outside', label: 'Buiten' };

  it('heeft precies de toegestane sleutelset (geen chatgeschiedenis, geen opties/vraag)', () => {
    const prompt = buildMessagePrompt({ chosenConcepts: [want, outside] });
    expect(Object.keys(prompt).sort()).toEqual(
      ['aacRules', 'chosenConcepts', 'goal', 'systemRules', 'task', 'userContext'].sort(),
    );
    expect(prompt).not.toHaveProperty('history');
    expect(prompt).not.toHaveProperty('messages');
    expect(prompt).not.toHaveProperty('availableSymbols');
  });

  it('draagt de vaste systeem-, doel- en AAC-regels mee en de gekozen concepten', () => {
    const prompt = buildMessagePrompt({ chosenConcepts: [want, outside] });
    expect(prompt.task).toBe(AI_TASK_GENERATE_MESSAGE);
    expect(prompt.systemRules).toEqual([...SYSTEM_RULES]);
    expect(prompt.goal).toBe(MESSAGE_GOAL);
    expect(prompt.aacRules).toEqual([...MESSAGE_AAC_RULES]);
    expect(prompt.chosenConcepts).toEqual([want, outside]);
    expect(prompt.userContext).toEqual([]);
  });

  it('de gekozen concepten bevatten uitsluitend concept + label (geen vrije velden)', () => {
    const prompt = buildMessagePrompt({ chosenConcepts: [want, outside] });
    for (const ref of prompt.chosenConcepts) {
      expect(Object.keys(ref).sort()).toEqual(['concept', 'label']);
    }
  });

  it('renderMessagePromptText blijft binnen de gesloten set', () => {
    const text = renderMessagePromptText(buildMessagePrompt({ chosenConcepts: [want, outside] }));
    expect(text).toContain('SYSTEEMREGELS:');
    expect(text).toContain('BEVESTIGDE CONCEPTEN');
    expect(text).toContain('outside (Buiten)');
    expect(text.toLowerCase()).not.toContain('chatgeschiedenis:');
  });
});

describe('renderPromptText — serialisatie blijft binnen de gesloten set', () => {
  it('bevat de kopjes en lekt geen niet-toegestane context', () => {
    const text = renderPromptText(
      buildAiPrompt({
        conversationContext: [{ concept: 'want', label: 'Iets willen' }],
        availableSymbols: [{ concept: 'outside', label: 'Buiten' }],
      }),
    );
    expect(text).toContain('SYSTEEMREGELS:');
    expect(text).toContain('GESPREKSCONTEXT');
    expect(text).toContain('TOEGESTANE OPTIES:');
    expect(text).toContain('outside (Buiten)');
    expect(text.toLowerCase()).not.toContain('chatgeschiedenis:');
  });
});
