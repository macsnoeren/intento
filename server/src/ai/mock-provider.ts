import { ROOT_PROMPT } from '../conversation/engine.js';
import type { AiOption, AiPrompt, AiProvider, AiQuestionDecision } from './provider.js';

/**
 * Deterministische mock-provider (T5.1, DESIGN §7.7).
 *
 * De standaardprovider voor dev en **alle tests**: geen netwerk, geen API-key, en dezelfde invoer levert
 * altijd exact dezelfde uitvoer. Zo zijn de orchestrator en (later) de gespreksflow reproduceerbaar te
 * testen zonder een echt model. De mock respecteert de AAC-begrenzing: hij stelt **uitsluitend** opties
 * voor die in `availableSymbols` staan (nooit een verzonnen concept).
 *
 * De confidence loopt af met de positie in de aangeboden opties (bibliotheekvolgorde) en is geklemd op
 * [0.3, 0.9] — voldoende spreiding om de drempellogica van T5.2 te kunnen testen, zonder echte AI-
 * onzekerheid te suggereren.
 */

/** Hoogste zekerheid (eerste optie) en de afname per volgende positie; ondergrens houdt alles > 0. */
const TOP_CONFIDENCE = 0.9;
const CONFIDENCE_STEP = 0.15;
const MIN_CONFIDENCE = 0.3;

/** Rondt af op 2 decimalen zodat de uitvoer stabiel en leesbaar is (geen drijvende-komma-ruis). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Zekerheid voor de optie op positie `index`: aflopend vanaf de top, geklemd op de ondergrens. */
function confidenceForIndex(index: number): number {
  return round2(Math.max(MIN_CONFIDENCE, TOP_CONFIDENCE - index * CONFIDENCE_STEP));
}

export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
    const options: AiOption[] = prompt.availableSymbols.map((ref, index) => ({
      symbol: ref.concept,
      confidence: confidenceForIndex(index),
    }));

    // Startvraag zonder keuzes → de vaste intentievraag; anders een verfijnvraag bij de laatste keuze.
    const question =
      prompt.lastChoice === null
        ? ROOT_PROMPT
        : `Wat past het best bij "${prompt.lastChoice.label}"?`;

    return Promise.resolve({
      question,
      options,
      reason: `mock: ${options.length} optie(s) in bibliotheekvolgorde, aflopende zekerheid`,
    });
  }
}
