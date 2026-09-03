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

  it('staat de schrijfmethoden DELETE/PUT/PATCH toe in de CORS-preflight (T8.4)', async () => {
    // @fastify/cors v11 versmalde de default `methods` naar GET,HEAD,POST; zonder expliciete
    // lijst blokkeert de browser elke cross-origin DELETE/PUT/PATCH nog vóór de route draait.
    for (const method of ['DELETE', 'PUT', 'PATCH'] as const) {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/users/willekeurig-id',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': method,
        },
      });

      expect(response.statusCode).toBe(204);
      const allowed = String(response.headers['access-control-allow-methods'] ?? '')
        .split(',')
        .map((value) => value.trim());
      expect(allowed).toContain(method);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    }
  });

  it('houdt de origin-restrictie: geen wildcard, geen echo van een vreemde origin', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/users/willekeurig-id',
      headers: {
        origin: 'https://aanvaller.example',
        'access-control-request-method': 'DELETE',
      },
    });

    // Met een statische `origin` antwoordt de plugin altijd met de geconfigureerde origin; de
    // browser weigert het antwoord dan omdat die niet met de eigen origin overeenkomt. Wat hier
    // misgaat als iemand de configuratie verruimt: een `*` of een echo van de vreemde origin.
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
    expect(response.headers['access-control-allow-origin']).not.toBe('https://aanvaller.example');
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

  it('eist https voor de spraakdienst in productie', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        SIGNING_SECRET: 'een-echte-secret',
        ENCRYPTION_KEY: 'een-echte-sleutel',
        COOKIE_SECURE: 'true',
        SMTP_HOST: 'mail.intento.test',
        EMAIL_VERIFICATION_URL_BASE: 'https://app.intento.test/verify-email',
        APP_BASE_URL: 'https://app.intento.test',
        SPEECH_PROVIDER: 'http',
        SPEECH_SERVICE_URL: 'http://intento-speech:5002',
      }),
    ).toThrow(/SPEECH_SERVICE_URL moet https zijn/);
  });

  it('laat plain http toe op een gesloten netwerk, maar dan mét gedeeld geheim', () => {
    const base = {
      NODE_ENV: 'production',
      SIGNING_SECRET: 'een-echte-secret',
      ENCRYPTION_KEY: 'een-echte-sleutel',
      COOKIE_SECURE: 'true',
      SMTP_HOST: 'mail.intento.test',
      EMAIL_VERIFICATION_URL_BASE: 'https://app.intento.test/verify-email',
      APP_BASE_URL: 'https://app.intento.test',
      SPEECH_PROVIDER: 'http',
      SPEECH_SERVICE_URL: 'http://intento-speech:5002',
      SPEECH_ALLOW_INSECURE_HTTP: 'true',
    };

    // Zonder TLS is het token het enige dat de dienst nog afschermt; de vlag alleen is niet genoeg.
    expect(() => loadEnv(base)).toThrow(/SPEECH_SERVICE_TOKEN is verplicht/);
    expect(() => loadEnv({ ...base, SPEECH_SERVICE_TOKEN: 'spr_geheim' })).not.toThrow();
  });

  it('vertrouwt standaard geen enkele proxy', () => {
    expect(
      loadEnv({
        NODE_ENV: 'test',
        SIGNING_SECRET: 'test-signing-secret',
        ENCRYPTION_KEY: 'test-encryption-key',
      }).TRUST_PROXY,
    ).toBe(false);
  });

  it('neemt een adresvorm over zoals fastify hem verwacht', () => {
    const env = (value: string) =>
      loadEnv({
        NODE_ENV: 'test',
        SIGNING_SECRET: 'test-signing-secret',
        ENCRYPTION_KEY: 'test-encryption-key',
        TRUST_PROXY: value,
      }).TRUST_PROXY;

    expect(env('true')).toBe(true);
    expect(env('uniquelocal')).toBe('uniquelocal');
    expect(env('172.18.0.0/16')).toBe('172.18.0.0/16');
  });

  it('weigert de oude hop-telling in plaats van hem als adres door te geven', () => {
    // `TRUST_PROXY=1` was jarenlang de manier om "één proxy ervoor" te zeggen. Fastify heeft die
    // vorm verwijderd (GHSA-3m5p-2c4r-xxw2) en zou "1" nu als adres lezen dat op niets slaat —
    // stilzwijgend, met de proxy in plaats van de bezoeker in elke logregel. Dus: hard falen.
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        SIGNING_SECRET: 'test-signing-secret',
        ENCRYPTION_KEY: 'test-encryption-key',
        TRUST_PROXY: '1',
      }),
    ).toThrow(/geen aantal hops meer/);
  });

  it('eist een mailserver in productie (anders geen verificatiemails)', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        SIGNING_SECRET: 'een-echte-secret',
        ENCRYPTION_KEY: 'een-echte-sleutel',
        COOKIE_SECURE: 'true',
        EMAIL_VERIFICATION_URL_BASE: 'https://app.intento.test/verify-email',
      }),
    ).toThrow(/SMTP_URL of SMTP_HOST/);
  });

  it('neemt in productie ook genoegen met de losse SMTP-velden', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        SIGNING_SECRET: 'een-echte-secret',
        ENCRYPTION_KEY: 'een-echte-sleutel',
        COOKIE_SECURE: 'true',
        SMTP_HOST: 'mail.mijndomein.nl',
        SMTP_USER: 'noreply@jmnl.nl',
        SMTP_PASSWORD: 'wachtwoord',
        EMAIL_VERIFICATION_URL_BASE: 'https://app.intento.test/verify-email',
        APP_BASE_URL: 'https://app.intento.test',
      }),
    ).not.toThrow();
  });

  it('weigert beide schrijfwijzen tegelijk in plaats van er stilletjes één te kiezen', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        SIGNING_SECRET: 'test-signing-secret',
        ENCRYPTION_KEY: 'test-encryption-key',
        SMTP_URL: 'smtps://user:pass@smtp.intento.test:465',
        SMTP_HOST: 'mail.mijndomein.nl',
      }),
    ).toThrow(/allebei gezet/);
  });

  it('weigert SMTP_SECURE=none zodra er een wachtwoord over de lijn zou gaan', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        SIGNING_SECRET: 'test-signing-secret',
        ENCRYPTION_KEY: 'test-encryption-key',
        SMTP_HOST: 'mail.mijndomein.nl',
        SMTP_SECURE: 'none',
        SMTP_USER: 'noreply@jmnl.nl',
        SMTP_PASSWORD: 'wachtwoord',
      }),
    ).toThrow(/SMTP_SECURE/);
  });

  it('weigert een half ingevulde inlog (wel gebruiker, geen wachtwoord)', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        SIGNING_SECRET: 'test-signing-secret',
        ENCRYPTION_KEY: 'test-encryption-key',
        SMTP_HOST: 'mail.mijndomein.nl',
        SMTP_USER: 'noreply@jmnl.nl',
      }),
    ).toThrow(/SMTP_PASSWORD/);
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

  it('eist een https-app-URL in productie (T13.2)', () => {
    // De meldingsmail aan de begeleider bevat een link naar de app; die mag niet over plain HTTP.
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        SIGNING_SECRET: 'een-echte-secret',
        ENCRYPTION_KEY: 'een-echte-sleutel',
        COOKIE_SECURE: 'true',
        SMTP_URL: 'smtps://user:pass@smtp.intento.test:465',
        EMAIL_VERIFICATION_URL_BASE: 'https://app.intento.test/verify-email',
        APP_BASE_URL: 'http://app.intento.test',
      }),
    ).toThrow(/APP_BASE_URL/);
  });

  it('accepteert een geldige productie-configuratie', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      SIGNING_SECRET: 'een-echte-secret',
      ENCRYPTION_KEY: 'een-echte-sleutel',
      COOKIE_SECURE: 'true',
      SMTP_URL: 'smtps://user:pass@smtp.intento.test:465',
      EMAIL_VERIFICATION_URL_BASE: 'https://app.intento.test/verify-email',
      APP_BASE_URL: 'https://app.intento.test',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.COOKIE_SECURE).toBe(true);
  });
});
