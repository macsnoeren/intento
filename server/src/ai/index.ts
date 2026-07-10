import type { Env } from '../env.js';
import { MockAiProvider } from './mock-provider.js';
import { AiOrchestrator } from './orchestrator.js';
import type { AiProvider } from './provider.js';

/**
 * AI-module (T5.1): publieke oppervlakte + provider-fabriek.
 *
 * `createAiProvider` kiest op basis van `AI_PROVIDER` de concrete provider achter de
 * provider-agnostische interface (ADR-0008). In T5.1 is alleen de deterministische `mock` beschikbaar;
 * echte providers (bv. een self-hosted `ollama`) worden in T5.2/T5.6 aangesloten. Onbekende/nog niet
 * aangesloten providers falen **luid** bij het opstarten in plaats van stilletjes verkeerd te draaien.
 */

export * from './provider.js';
export * from './prompt.js';
export { AiOrchestrator } from './orchestrator.js';
export { MockAiProvider } from './mock-provider.js';

/** Bouwt de AI-provider uit de env. Zie `Env.AI_PROVIDER`. */
export function createAiProvider(env: Env): AiProvider {
  switch (env.AI_PROVIDER) {
    case 'mock':
      return new MockAiProvider();
    case 'ollama':
      // De echte, wachtrij-/worker-gebaseerde Ollama-provider volgt in T5.5/T5.6. Tot die tijd
      // weigeren we te starten zodat een misconfiguratie niet stil op "geen AI" uitkomt.
      throw new Error(
        'AI_PROVIDER=ollama is nog niet aangesloten (volgt in T5.5/T5.6); gebruik AI_PROVIDER=mock.',
      );
    default: {
      // Exhaustiveness-guard: dwingt af dat elke nieuwe AI_PROVIDER-waarde hier wordt afgehandeld.
      const exhaustive: never = env.AI_PROVIDER;
      throw new Error(`Onbekende AI_PROVIDER: ${String(exhaustive)}`);
    }
  }
}

/** Gemak: bouwt een orchestrator met de uit de env gekozen provider. */
export function createAiOrchestrator(env: Env): AiOrchestrator {
  return new AiOrchestrator(createAiProvider(env));
}
