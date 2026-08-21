import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { MockAiProvider } from './mock-provider.js';
import { AiOrchestrator } from './orchestrator.js';
import { QueueAiProvider } from './queue-provider.js';
import { queueConfigFromEnv } from './job-queue.js';
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
export * from './thresholds.js';
export { AiOrchestrator } from './orchestrator.js';
export { MockAiProvider } from './mock-provider.js';
export { QueueAiProvider } from './queue-provider.js';
export { AiWorkerBusyError, AiWorkerUnavailableError } from './errors.js';
export { validateAiOptions, type ValidatedOption, type ValidationResult } from './validation.js';

/**
 * Bouwt de AI-provider uit de env (zie `Env.AI_PROVIDER`). `queue` heeft de Prisma-client nodig (de
 * wachtrij leeft in de db); voor de mock is die niet nodig.
 */
export function createAiProvider(env: Env, prisma: PrismaClient = defaultPrisma): AiProvider {
  switch (env.AI_PROVIDER) {
    case 'mock':
      return new MockAiProvider();
    case 'queue':
      // Gedistribueerde workers (T5.5, ADR-0010): de backend zet jobs op de wachtrij; externe workers
      // (T5.6) verwerken ze en leveren gestructureerde output terug.
      return new QueueAiProvider(prisma, queueConfigFromEnv(env));
    case 'ollama':
      // Een directe, in-process Ollama-provider is bewust niet gebouwd: Ollama draait als losstaande
      // worker (T5.6) achter de wachtrij (AI_PROVIDER=queue). Weigeren zodat een misconfiguratie niet
      // stil op "geen AI" uitkomt.
      throw new Error(
        'AI_PROVIDER=ollama is niet in-process aangesloten; draai Ollama als worker (T5.6) met AI_PROVIDER=queue.',
      );
    default: {
      // Exhaustiveness-guard: dwingt af dat elke nieuwe AI_PROVIDER-waarde hier wordt afgehandeld.
      const exhaustive: never = env.AI_PROVIDER;
      throw new Error(`Onbekende AI_PROVIDER: ${String(exhaustive)}`);
    }
  }
}

/** Gemak: bouwt een orchestrator met de uit de env gekozen provider. */
export function createAiOrchestrator(
  env: Env,
  prisma: PrismaClient = defaultPrisma,
): AiOrchestrator {
  return new AiOrchestrator(createAiProvider(env, prisma));
}
