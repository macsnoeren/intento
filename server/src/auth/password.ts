import argon2 from 'argon2';

/**
 * Wachtwoord-hashing met **argon2id** (CLAUDE.md security-checklist, DESIGN §9.4).
 *
 * argon2id is de aanbevolen variant voor wachtwoordopslag: memory-hard tegen GPU-brute-force
 * én bestand tegen side-channels. De `argon2`-library genereert per hash een eigen salt en
 * bewaart alle parameters in de PHC-string, zodat `verify` geen aparte salt-opslag nodig heeft.
 */

// Bewust zwaardere-dan-default kosten binnen de OWASP-aanbevelingen voor argon2id.
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hasht een wachtwoord tot een zelfbeschrijvende PHC-string (incl. salt en parameters). */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

/**
 * Verifieert een wachtwoord tegen een hash. Vangt een corrupte/onleesbare hash af als
 * "komt niet overeen" i.p.v. een throw, zodat de login-flow er niet op crasht.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
