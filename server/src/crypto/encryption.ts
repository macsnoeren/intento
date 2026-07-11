import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Env } from '../env.js';

/**
 * Symmetrische veldversleuteling at-rest (T6.1, DESIGN §9.4, CLAUDE.md security-checklist).
 *
 * Gevoelige, vrij-tekst PII (persoonlijke context: namen, relaties) mag NOOIT plaintext in de db staan.
 * Deze module versleutelt zulke velden met **AES-256-GCM** — authenticated encryption, zodat geknoei met
 * de cijfertekst bij het ontsleutelen wordt gedetecteerd (auth-tag). Anders dan bij tokens (die we alleen
 * *hashen*, want ze hoeven nooit terug) is hier terugleesbaarheid vereist: de begeleider/AI heeft de
 * leesbare waarde nodig. Daarom versleuteling i.p.v. hashing.
 *
 * Sleutelafleiding: `ENCRYPTION_KEY` is een vrije string (de operator kiest de lengte). We leiden er een
 * vaste 32-byte AES-sleutel uit via SHA-256, zodat elke geldige env-waarde bruikbaar is zonder de operator
 * exact 32 bytes hex te laten invoeren. De prod-guard in `env.ts` weigert de dev-default in productie.
 *
 * Opslagformaat (één ondoorzichtige string per veld):
 *   `v1:<base64url(iv)>:<base64url(authTag)>:<base64url(ciphertext)>`
 * Een versieprefix (`v1`) houdt ruimte voor een latere sleutelrotatie/algoritmewissel zonder de data te
 * hoeven raden. Elke versleuteling krijgt een **nieuwe random 12-byte IV** (nooit hergebruikt bij dezelfde
 * sleutel — kritisch voor GCM).
 */

/** Prefix die het opslagformaat/versie markeert; bij het ontsleutelen gecontroleerd. */
const FORMAT_VERSION = 'v1';
/** GCM-standaard IV-lengte (96 bit): aanbevolen en het efficiëntst voor AES-GCM. */
const IV_BYTES = 12;

/** Ontsleutelbare, terugleesbare veldversleuteling. */
export interface Encryptor {
  /** Versleutelt plaintext naar de ondoorzichtige opslagstring (zie moduletoelichting). */
  encrypt(plaintext: string): string;
  /** Ontsleutelt een eerder met `encrypt` gemaakte string; gooit bij een ongeldig/geknoeid formaat. */
  decrypt(payload: string): string;
}

/** Leidt de vaste 32-byte AES-256-sleutel af uit de env-secret (SHA-256; altijd 32 bytes). */
function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * Bouwt een `Encryptor` op basis van `ENCRYPTION_KEY`. Eén instantie per app (de sleutel wordt één keer
 * afgeleid). Injecteerbaar in routes/services zodat de versleutel-logica op één plek leeft en te testen is.
 */
export function createEncryptor(env: Pick<Env, 'ENCRYPTION_KEY'>): Encryptor {
  const key = deriveKey(env.ENCRYPTION_KEY);

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return [
        FORMAT_VERSION,
        iv.toString('base64url'),
        authTag.toString('base64url'),
        ciphertext.toString('base64url'),
      ].join(':');
    },

    decrypt(payload: string): string {
      const parts = payload.split(':');
      if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
        throw new Error('Ongeldig versleuteld veld: onbekend formaat of versie.');
      }
      const [, ivB64, tagB64, ctB64] = parts;
      const iv = Buffer.from(ivB64!, 'base64url');
      const authTag = Buffer.from(tagB64!, 'base64url');
      const ciphertext = Buffer.from(ctB64!, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },
  };
}
