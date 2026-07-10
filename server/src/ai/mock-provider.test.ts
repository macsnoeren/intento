import { describe, expect, it } from 'vitest';
import { ROOT_PROMPT } from '../conversation/engine.js';
import { MockAiProvider } from './mock-provider.js';
import { AiOrchestrator } from './orchestrator.js';
import { aiQuestionDecisionSchema } from './provider.js';
import { buildAiPrompt } from './prompt.js';

const want = { concept: 'want', label: 'Iets willen' };
const doActivity = { concept: 'do-activity', label: 'Iets doen' };
const outside = { concept: 'outside', label: 'Buiten' };
const walking = { concept: 'walking', label: 'Wandelen' };

describe('MockAiProvider — deterministische, AAC-begrensde uitvoer', () => {
  const provider = new MockAiProvider();

  it('geeft geldige, zod-conforme uitvoer voor de startvraag', async () => {
    const decision = await provider.selectNextQuestion(
      buildAiPrompt({ conversationContext: [], availableSymbols: [want, outside] }),
    );
    expect(() => aiQuestionDecisionSchema.parse(decision)).not.toThrow();
    expect(decision.question).toBe(ROOT_PROMPT);
    expect(decision.options.map((o) => o.symbol)).toEqual(['want', 'outside']);
  });

  it('stelt uitsluitend aangeboden opties voor (nooit een verzonnen concept)', async () => {
    const available = [doActivity, outside, walking];
    const decision = await provider.selectNextQuestion(
      buildAiPrompt({ conversationContext: [want], availableSymbols: available }),
    );
    const allowed = new Set(available.map((s) => s.concept));
    for (const option of decision.options) {
      expect(allowed.has(option.symbol)).toBe(true);
    }
  });

  it('confidence loopt af met de positie en blijft binnen [0.3, 0.9]', async () => {
    const decision = await provider.selectNextQuestion(
      buildAiPrompt({
        conversationContext: [want],
        availableSymbols: [doActivity, outside, walking],
      }),
    );
    expect(decision.options.map((o) => o.confidence)).toEqual([0.9, 0.75, 0.6]);
  });

  it('klemt de confidence nooit onder 0.3, ook bij veel opties', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ concept: `c${i}`, label: `C${i}` }));
    const decision = await provider.selectNextQuestion(
      buildAiPrompt({ conversationContext: [want], availableSymbols: many }),
    );
    for (const option of decision.options) {
      expect(option.confidence).toBeGreaterThanOrEqual(0.3);
      expect(option.confidence).toBeLessThanOrEqual(0.9);
    }
  });

  it('is deterministisch: dezelfde invoer levert exact dezelfde uitvoer', async () => {
    const input = { conversationContext: [want], availableSymbols: [outside, walking] };
    const a = await provider.selectNextQuestion(buildAiPrompt(input));
    const b = await provider.selectNextQuestion(buildAiPrompt(input));
    expect(a).toEqual(b);
  });

  it('verfijnvraag verwijst naar de laatste keuze', async () => {
    const decision = await provider.selectNextQuestion(
      buildAiPrompt({ conversationContext: [want, outside], availableSymbols: [walking] }),
    );
    expect(decision.question).toContain('Buiten');
  });
});

describe('AiOrchestrator — vorm afdwingen met de mock-provider', () => {
  it('levert geldige, zod-gevalideerde uitvoer via de orchestrator', async () => {
    const orchestrator = new AiOrchestrator(new MockAiProvider());
    expect(orchestrator.providerName).toBe('mock');

    const decision = await orchestrator.selectNextQuestion({
      conversationContext: [want],
      availableSymbols: [doActivity, outside],
    });
    expect(() => aiQuestionDecisionSchema.parse(decision)).not.toThrow();
    expect(decision.options).toHaveLength(2);
  });

  it('weigert (gooit) wanneer de provider een ongeldige vorm teruggeeft', async () => {
    const brokenProvider = {
      name: 'broken',
      // Ongeldig: confidence buiten [0,1] — de orchestrator valideert opnieuw en gooit.
      selectNextQuestion: async () => ({
        question: 'x',
        options: [{ symbol: 'want', confidence: 5 }],
        reason: 'kapot',
      }),
    };
    const orchestrator = new AiOrchestrator(brokenProvider);
    await expect(
      orchestrator.selectNextQuestion({ conversationContext: [], availableSymbols: [want] }),
    ).rejects.toThrow();
  });

  it('weigert een verzonnen (niet-string/leeg) concept van een provider', async () => {
    const brokenProvider = {
      name: 'broken',
      selectNextQuestion: async () => ({
        question: 'x',
        options: [{ symbol: '', confidence: 0.9 }],
        reason: 'leeg concept',
      }),
    };
    const orchestrator = new AiOrchestrator(brokenProvider);
    await expect(
      orchestrator.selectNextQuestion({ conversationContext: [], availableSymbols: [want] }),
    ).rejects.toThrow();
  });
});
