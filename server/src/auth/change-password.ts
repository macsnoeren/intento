import type { ChangePasswordRequest } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import { hashPassword, verifyPassword } from './password.js';
import { hashSessionToken } from './session.js';

/**
 * Eigen wachtwoord wijzigen (T2.5, DESIGN §2, §6.2 Account, §9.4).
 *
 * Nodig omdat een begeleider die met het **tijdelijke** wachtwoord uit T2.4 inlogt dat anders niet
 * kan vervangen: het zou onbeperkt geldig blijven én bekend zijn bij de beheerder die het aanmaakte.
 *
 * Twee beveiligingskeuzes zitten hier vast ingebakken:
 *
 *  1. **Her-authenticatie.** Het huidige wachtwoord moet mee. Een gekaapte sessie (of een onbeheerd
 *     ingelogd scherm) kan het account daardoor niet overnemen door er stilletjes een nieuw
 *     wachtwoord op te zetten. Bij een fout huidig wachtwoord komt er één generieke fout terug —
 *     geen onderscheid dat iets over het account verraadt.
 *  2. **Overige sessies intrekken.** Na een wijziging verdwijnen alle sessies van dit account
 *     behálve de huidige. Wie het oude wachtwoord kende en ergens nog ingelogd stond, ligt er
 *     daarmee uit; de wijziger zelf blijft ingelogd (anders zou hij zichzelf uit zijn eigen scherm
 *     werken en het net gezette wachtwoord meteen weer moeten intypen).
 *
 * Bewust *geen* lockout-boekhouding zoals bij login (`verifyLogin`): hier is de aanroeper al
 * geauthenticeerd, en een mislukte poging mag het account van een legitieme gebruiker niet
 * blokkeren. Brute-force op deze route wordt door rate limiting op de route afgedekt.
 */

export type ChangePasswordResult =
  { ok: true; revokedSessions: number } | { ok: false; reason: 'invalid_current_password' };

/**
 * Wisselt het wachtwoord van `account` (het ingelogde account — nooit dat van een ander; de
 * aanroeper haalt het uit de sessie, niet uit de invoer) en trekt de overige sessies in.
 *
 * `currentSessionToken` is het rauwe token uit de cookie van dit verzoek; we hashen het met
 * dezelfde functie als bij het aanmaken van de sessie en sparen precies die ene rij.
 */
export async function changeOwnPassword(
  prisma: PrismaClient,
  account: AccountModel,
  input: ChangePasswordRequest,
  currentSessionToken: string | null,
): Promise<ChangePasswordResult> {
  const currentOk = await verifyPassword(account.passwordHash, input.currentPassword);
  if (!currentOk) return { ok: false, reason: 'invalid_current_password' };

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.account.update({
    where: { id: account.id },
    // Ook de lockout-boekhouding schoonvegen: wie zijn wachtwoord aantoonbaar kent, hoort niet
    // met een halfvolle pogingenteller of een lopende blokkade achter te blijven. En de
    // tijdelijk-wachtwoord-markering (T2.6) valt hier weg: vanaf nu kent alleen de houder zelf het
    // wachtwoord, dus de gate die hem tot deze route beperkte is niet langer van toepassing.
    data: {
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
      mustChangePassword: false,
    },
  });

  const { count } = await prisma.session.deleteMany({
    where: {
      accountId: account.id,
      ...(currentSessionToken === null
        ? {}
        : { tokenHash: { not: hashSessionToken(currentSessionToken) } }),
    },
  });

  return { ok: true, revokedSessions: count };
}
