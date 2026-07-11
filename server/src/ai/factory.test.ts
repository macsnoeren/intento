import { describe, expect, it } from 'vitest';
import { loadEnv } from '../env.js';
import { createAiOrchestrator, createAiProvider, MockAiProvider, QueueAiProvider } from './index.js';
import { prisma } from '../db/prisma.js';

/** Minimale, geldige env voor de tests (dev-defaults volstaan). */
const baseEnv = {
  SIGNING_SECRET: 'test-signing-secret',
  ENCRYPTION_KEY: 'test-encryption-key',
} as const;

describe('createAiProvider — providerkeuze uit de env (ADR-0008)', () => {
  it('bouwt de deterministische mock bij AI_PROVIDER=mock (standaard)', () => {
    const env = loadEnv({ ...baseEnv });
    const provider = createAiProvider(env);
    expect(provider).toBeInstanceOf(MockAiProvider);
    expect(provider.name).toBe('mock');
  });

  it('createAiOrchestrator wikkelt de gekozen provider', () => {
    const env = loadEnv({ ...baseEnv });
    expect(createAiOrchestrator(env).providerName).toBe('mock');
  });

  it('bouwt de wachtrij-provider bij AI_PROVIDER=queue (T5.5)', () => {
    const env = loadEnv({ ...baseEnv, AI_PROVIDER: 'queue' });
    const provider = createAiProvider(env, prisma);
    expect(provider).toBeInstanceOf(QueueAiProvider);
    expect(provider.name).toBe('queue');
  });

  it('weigert een in-process ollama-provider (Ollama draait als worker achter de wachtrij, T5.6)', () => {
    const env = loadEnv({
      ...baseEnv,
      AI_PROVIDER: 'ollama',
      AI_API_URL: 'https://ollama.local',
      AI_MODEL: 'llama3',
    });
    expect(() => createAiProvider(env)).toThrow(/niet in-process aangesloten/i);
  });
});

describe('env-validatie — echte provider vereist verbindingsconfig', () => {
  it('weigert AI_PROVIDER=ollama zonder URL/model', () => {
    expect(() => loadEnv({ ...baseEnv, AI_PROVIDER: 'ollama' })).toThrow(/AI_API_URL|AI_MODEL/);
  });
});
