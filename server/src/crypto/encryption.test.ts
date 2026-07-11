import { describe, expect, it } from 'vitest';
import { createEncryptor } from './encryption.js';

/**
 * Encryptor-tests (T6.1, DESIGN §9.4). Toetsen de kern-eigenschappen van de veldversleuteling: een
 * roundtrip levert de plaintext terug, de cijfertekst bevat de plaintext niet, elke versleuteling is uniek
 * (random IV), en geknoei/een verkeerde sleutel wordt gedetecteerd (AES-GCM auth-tag).
 */
describe('createEncryptor (AES-256-GCM veldversleuteling)', () => {
  const enc = createEncryptor({ ENCRYPTION_KEY: 'test-encryption-key' });

  it('versleutelt en ontsleutelt terug naar de oorspronkelijke waarde (roundtrip)', () => {
    const plaintext = 'Anna de Vries';
    const cipher = enc.encrypt(plaintext);
    expect(cipher).not.toContain(plaintext);
    expect(enc.decrypt(cipher)).toBe(plaintext);
  });

  it('ondersteunt lege strings en unicode', () => {
    for (const value of ['', 'Rex 🐕', 'café/straße']) {
      expect(enc.decrypt(enc.encrypt(value))).toBe(value);
    }
  });

  it('produceert bij dezelfde invoer telkens een andere cijfertekst (unieke IV)', () => {
    const a = enc.encrypt('zelfde waarde');
    const b = enc.encrypt('zelfde waarde');
    expect(a).not.toBe(b);
    expect(enc.decrypt(a)).toBe(enc.decrypt(b));
  });

  it('gebruikt het versie-getagde formaat v1:iv:tag:ciphertext', () => {
    const parts = enc.encrypt('x').split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  it('weigert een met een andere sleutel gemaakte cijfertekst (auth-tag/sleutel-mismatch)', () => {
    const other = createEncryptor({ ENCRYPTION_KEY: 'een-andere-sleutel' });
    const cipher = other.encrypt('geheim');
    expect(() => enc.decrypt(cipher)).toThrow();
  });

  it('weigert een geknoeide cijfertekst', () => {
    const parts = enc.encrypt('geheim geheim geheim').split(':');
    // Eén byte in de cijfertekst omdraaien → GCM-auth-tag klopt niet meer.
    const ct = Buffer.from(parts[3]!, 'base64url');
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString('base64url');
    expect(() => enc.decrypt(parts.join(':'))).toThrow();
    expect(() => enc.decrypt('kapot')).toThrow();
  });
});
