import { describe, expect, it } from 'vitest';
import { loadEnv } from '../env.js';
import { createAiOrchestrator, createAiProvider, MockAiProvider } from './index.js';

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

  it('weigert een echte provider te starten zolang die niet is aangesloten (T5.5/T5.6)', () => {
    const env = loadEnv({
      ...baseEnv,
      AI_PROVIDER: 'ollama',
      AI_API_URL: 'https://ollama.local',
      AI_MODEL: 'llama3',
    });
    expect(() => createAiProvider(env)).toThrow(/nog niet aangesloten/i);
  });
});

describe('env-validatie — echte provider vereist verbindingsconfig', () => {
  it('weigert AI_PROVIDER=ollama zonder URL/model', () => {
    expect(() => loadEnv({ ...baseEnv, AI_PROVIDER: 'ollama' })).toThrow(/AI_API_URL|AI_MODEL/);
  });
});
