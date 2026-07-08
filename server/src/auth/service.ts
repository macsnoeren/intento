import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import { hashPassword, verifyPassword } from './password.js';

/**
 * Login-service met account-lockout (DESIGN §9.4, CLAUDE.md security-checklist).
 *
 * - Wachtwoorden worden met argon2id geverifieerd; nooit plaintext vergeleken.
 * - Bij een onbekende e-mail draaien we tóch een argon2-verify tegen een dummy-hash, zodat
 *   de responstijd niet verraadt of een account bestaat (timing-aanval-mitigatie).
 * - Opeenvolgende mislukte logins tellen op; bij het bereiken van de drempel wordt het
 *   account tijdelijk geblokkeerd. Een geslaagde login reset teller en blokkade.
 */

export interface LoginConfig {
  maxAttempts: number;
  lockoutMinutes: number;
}

export type LoginResult =
  | { ok: true; account: AccountModel }
  | { ok: false; reason: 'invalid_credentials' | 'account_locked' };

// Eén dummy-hash (lazily), zodat login bij een onbekende e-mail evenveel werk doet als bij
// een bestaande. Voorkomt dat verschil in responstijd het bestaan van accounts lekt.
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('intento-dummy-password-for-constant-time');
  return dummyHashPromise;
}

/**
 * Verifieert inloggegevens en past lockout-boekhouding toe. Geeft bij succes het account
 * terug; anders een generieke reden (bewust geen onderscheid tussen "onbekende e-mail" en
 * "fout wachtwoord" naar de client).
 */
export async function verifyLogin(
  prisma: PrismaClient,
  email: string,
  password: string,
  config: LoginConfig,
): Promise<LoginResult> {
  const account = await prisma.account.findUnique({ where: { email } });

  if (!account) {
    // Constante-tijd-pad: verifieer tegen de dummy-hash en faal altijd.
    await verifyPassword(await getDummyHash(), password);
    return { ok: false, reason: 'invalid_credentials' };
  }

  // Actieve lockout: weiger zonder het wachtwoord te controleren.
  if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
    return { ok: false, reason: 'account_locked' };
  }

  const passwordOk = await verifyPassword(account.passwordHash, password);

  if (!passwordOk) {
    const attempts = account.failedLoginAttempts + 1;
    const reachedLimit = attempts >= config.maxAttempts;
    await prisma.account.update({
      where: { id: account.id },
      data: reachedLimit
        ? {
            // Blokkeer en reset de teller; na de lockout begint het tellen opnieuw.
            failedLoginAttempts: 0,
            lockedUntil: new Date(Date.now() + config.lockoutMinutes * 60 * 1000),
          }
        : { failedLoginAttempts: attempts },
    });
    return { ok: false, reason: reachedLimit ? 'account_locked' : 'invalid_credentials' };
  }

  // Geslaagd: reset lockout-boekhouding als daar iets stond.
  if (account.failedLoginAttempts !== 0 || account.lockedUntil !== null) {
    await prisma.account.update({
      where: { id: account.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }
  return { ok: true, account };
}
