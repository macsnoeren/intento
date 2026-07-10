import { describe, expect, it } from 'vitest';
import { AAC_RULES, GOAL, SYSTEM_RULES, buildAiPrompt, renderPromptText } from './prompt.js';
import { AI_TASK_SELECT_NEXT_QUESTION } from './provider.js';

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
