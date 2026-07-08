import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('wachtwoord-hashing (argon2id)', () => {
  it('hasht met argon2id en verifieert het juiste wachtwoord', async () => {
    const hash = await hashPassword('geheim-wachtwoord');

    expect(hash).toMatch(/^\$argon2id\$/); // PHC-string, argon2id-variant
    expect(hash).not.toContain('geheim-wachtwoord'); // nooit plaintext
    expect(await verifyPassword(hash, 'geheim-wachtwoord')).toBe(true);
  });

  it('wijst een fout wachtwoord af', async () => {
    const hash = await hashPassword('geheim-wachtwoord');
    expect(await verifyPassword(hash, 'fout-wachtwoord')).toBe(false);
  });

  it('gebruikt per hash een eigen salt (verschillende hashes voor hetzelfde wachtwoord)', async () => {
    const a = await hashPassword('zelfde');
    const b = await hashPassword('zelfde');
    expect(a).not.toBe(b);
  });

  it('faalt netjes (false) op een corrupte hash', async () => {
    expect(await verifyPassword('geen-geldige-hash', 'wat-dan-ook')).toBe(false);
  });
});
