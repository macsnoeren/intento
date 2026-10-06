import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOWED_LICENSES,
  isLicenseAllowed,
  licenseFamily,
  normalizeLicense,
} from './licenses.js';
import { loadEnv } from '../env.js';

/** Licenties van externe symbolen (N8.3, INTENTO-NEW-DESIGN §15). */

describe('normalizeLicense', () => {
  const cases: [string | null, string | null, string][] = [
    ['CC BY-SA', null, 'CC-BY-SA'],
    ['CC BY-SA 4.0', null, 'CC-BY-SA-4.0'],
    ['Creative Commons Attribution-ShareAlike 3.0', null, 'CC-BY-SA-3.0'],
    ['CC-By', null, 'CC-BY'],
    ['CC BY 2.0 UK', null, 'CC-BY-2.0'],
    ['CC BY-NC-SA', null, 'CC-BY-NC-SA'],
    ['Creative Commons Attribution-NonCommercial-ShareAlike', null, 'CC-BY-NC-SA'],
    ['CC BY-ND', null, 'CC-BY-ND'],
    ['public domain', null, 'CC0'],
    ['CC0', null, 'CC0'],
    [null, 'https://creativecommons.org/licenses/by-sa/3.0/', 'CC-BY-SA-3.0'],
    ['licentie onbekend', 'https://creativecommons.org/licenses/by-nc/4.0/', 'CC-BY-NC-4.0'],
    [null, 'https://creativecommons.org/publicdomain/zero/1.0/', 'CC0'],
  ];
  it.each(cases)('%s / %s → %s', (text, url, key) => {
    expect(normalizeLicense(text, url).key).toBe(key);
  });

  it('maakt van iets onherkenbaars UNKNOWN', () => {
    for (const text of ['', 'onbekend', 'All rights reserved', 'ARASAAC', 'SA', 'CC']) {
      expect(normalizeLicense(text)).toEqual({ key: 'UNKNOWN', family: null });
    }
    expect(normalizeLicense(null, 'https://example.com/licentie').key).toBe('UNKNOWN');
  });
});

describe('isLicenseAllowed', () => {
  it('standaard CC0, CC BY en CC BY-SA, in elke versie', () => {
    for (const key of ['CC0', 'CC-BY', 'CC-BY-4.0', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0']) {
      expect(isLicenseAllowed(key, DEFAULT_ALLOWED_LICENSES)).toBe(true);
    }
    for (const key of ['CC-BY-NC-4.0', 'CC-BY-NC-SA', 'CC-BY-ND-4.0', 'UNKNOWN', 'own', 'MIT']) {
      expect(isLicenseAllowed(key, DEFAULT_ALLOWED_LICENSES)).toBe(false);
    }
    expect(isLicenseAllowed(normalizeLicense('onbekend'), DEFAULT_ALLOWED_LICENSES)).toBe(false);
  });

  it('volgt een eigen lijst', () => {
    expect(isLicenseAllowed('CC-BY-NC-4.0', ['CC-BY-NC'])).toBe(true);
    expect(isLicenseAllowed('CC-BY-SA-4.0', ['CC0'])).toBe(false);
  });

  it('familie van een sleutel', () => {
    expect(licenseFamily('CC-BY-SA-4.0')).toBe('CC-BY-SA');
    expect(licenseFamily('CC0')).toBe('CC0');
    expect(licenseFamily('own')).toBeNull();
  });
});

describe('VOCABULARY_ALLOWED_LICENSES', () => {
  const base = { NODE_ENV: 'test', SIGNING_SECRET: 's', ENCRYPTION_KEY: 'k' };

  it('standaard CC0, CC BY en CC BY-SA', () => {
    expect(loadEnv(base).VOCABULARY_ALLOWED_LICENSES).toEqual(['CC0', 'CC-BY', 'CC-BY-SA']);
  });

  it('een eigen lijst, en een onbekende familie wordt geweigerd', () => {
    expect(
      loadEnv({ ...base, VOCABULARY_ALLOWED_LICENSES: 'CC0, CC-BY' }).VOCABULARY_ALLOWED_LICENSES,
    ).toEqual(['CC0', 'CC-BY']);
    expect(() => loadEnv({ ...base, VOCABULARY_ALLOWED_LICENSES: 'CC0,MIT' })).toThrow();
  });
});
