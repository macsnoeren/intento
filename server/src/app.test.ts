import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { healthResponseSchema } from '@intento/shared';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  SIGNING_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'test-encryption-key',
});

describe('buildApp', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ env: testEnv });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health geeft 200 met geldige, schema-conforme body', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const parsed = healthResponseSchema.parse(response.json());
    expect(parsed.status).toBe('ok');
    expect(parsed.service).toBe('intento-server');
  });

  it('zet security headers via helmet', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers).toHaveProperty('content-security-policy');
  });

  it('onbekende route geeft 404 in de consistente foutstructuur', async () => {
    const response = await app.inject({ method: 'GET', url: '/bestaat-niet' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('loadEnv prod-guards', () => {
  it('weigert dev-default-secrets in productie', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        SIGNING_SECRET: 'dev-only-change-me',
        ENCRYPTION_KEY: 'dev-only-change-me-32-bytes-hex',
        COOKIE_SECURE: 'true',
      }),
    ).toThrow(/SIGNING_SECRET/);
  });

  it('eist COOKIE_SECURE=true in productie', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        SIGNING_SECRET: 'een-echte-secret',
        ENCRYPTION_KEY: 'een-echte-sleutel',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow(/COOKIE_SECURE/);
  });

  it('eist een SMTP_URL in productie (anders geen verificatiemails)', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        SIGNING_SECRET: 'een-echte-secret',
        ENCRYPTION_KEY: 'een-echte-sleutel',
        COOKIE_SECURE: 'true',
        EMAIL_VERIFICATION_URL_BASE: 'https://app.intento.test/verify-email',
      }),
    ).toThrow(/SMTP_URL/);
  });

  it('eist een https-verificatielink in productie', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        SIGNING_SECRET: 'een-echte-secret',
        ENCRYPTION_KEY: 'een-echte-sleutel',
        COOKIE_SECURE: 'true',
        SMTP_URL: 'smtps://user:pass@smtp.intento.test:465',
        EMAIL_VERIFICATION_URL_BASE: 'http://app.intento.test/verify-email',
      }),
    ).toThrow(/EMAIL_VERIFICATION_URL_BASE/);
  });

  it('accepteert een geldige productie-configuratie', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      SIGNING_SECRET: 'een-echte-secret',
      ENCRYPTION_KEY: 'een-echte-sleutel',
      COOKIE_SECURE: 'true',
      SMTP_URL: 'smtps://user:pass@smtp.intento.test:465',
      EMAIL_VERIFICATION_URL_BASE: 'https://app.intento.test/verify-email',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.COOKIE_SECURE).toBe(true);
  });
});
