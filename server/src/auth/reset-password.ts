import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import { generateTemporaryPassword } from './caregiver-account.js';
import { hashPassword } from './password.js';

/**
 * Nieuw tijdelijk wachtwoord uitgeven voor een vastgelopen account (T2.7, DESIGN §2, §6.2 Account,
 * §9.4).
 *
 * Sinds T2.6 zit een begeleider die zijn tijdelijke wachtwoord kwijtraakt (of het nooit ontving)
 * volledig klem: inloggen lukt niet, en zonder sessie is `POST /auth/password` (T2.5) onbereikbaar.
 * Hetzelfde geldt voor een account dat door de lockout is buitengesloten. Er was geen enkele weg
 * terug — geen "wachtwoord vergeten"-flow en geen manier voor de beheerder om opnieuw uit te geven.
 *
 * **Gekozen: beheerder geeft opnieuw uit, geen publieke "wachtwoord vergeten"-flow per e-mail.**
 * Zelfde afweging als bij T2.4: Intento moet **zonder mailserver** bruikbaar blijven, en een
 * begeleider-account ontstaat hier sowieso in een gesprek tussen beheerder en begeleider — die twee
 * kennen elkaar, dus het veiligste kanaal is dat van het aanmaken zelf. Een e-mailflow zou boven op
 * SMTP ook een tweede, publiek bereikbare weg naar een account openen; dat is winst voor gemak en
 * verlies voor het aanvalsoppervlak. (Een e-mailflow blijft mogelijk als latere aanvulling, met
 * dezelfde tokeneigenschappen als T1.4: gehasht, eenmalig, verlopend, neutrale respons.)
 *
 * De beheerder kiest het wachtwoord **niet** zelf — de server genereert het, precies zoals bij T2.4.
 * Dat scheelt niet alleen zwakke keuzes voor iemand anders, het houdt ook de bedoeling van T2.5
 * overeind: een beheerder zet nooit een wachtwoord dat blijvend is, hij geeft een sleutel af die de
 * houder bij de eerstvolgende login moet vervangen (`mustChangePassword`).
 *
 * Rol- en tenantgrenzen liggen in de route (`POST /admin/accounts/:id/password`): ADMIN, alléén
 * binnen de eigen organisatie en nooit op het eigen account.
 */

export interface ResetTemporaryPasswordResult {
  account: AccountModel;
  temporaryPassword: string;
  /** Aantal ingetrokken sessies van het doelaccount — álle, niet alleen de andere (zie hieronder). */
  revokedSessions: number;
}

/**
 * Zet een vers server-gegenereerd tijdelijk wachtwoord op `accountId` en trekt **alle** sessies van
 * dat account in.
 *
 * Anders dan bij het zelf wijzigen (T2.5, waar de huidige sessie bewust blijft) is hier niets te
 * sparen: de aanroeper is de beheerder, niet de houder. Elke lopende sessie van het doelaccount is
 * per definitie met het oude wachtwoord opgezet — of door iemand die dat wachtwoord ook kende — dus
 * die moeten allemaal dood, anders overleeft een gekaapte sessie juist de reset.
 *
 * De lockout-boekhouding wordt ook schoongeveegd: een account dat is vastgelopen op mislukte
 * pogingen zou anders na de reset nog steeds tegen een lopende blokkade aanlopen, en dat is precies
 * het probleem dat deze actie moet oplossen.
 */
export async function resetTemporaryPassword(
  prisma: PrismaClient,
  accountId: string,
): Promise<ResetTemporaryPasswordResult> {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const account = await prisma.account.update({
    where: { id: accountId },
    data: {
      passwordHash,
      // Weer gemarkeerd (T2.6): dit wachtwoord kent de beheerder óók, dus het account mag straks
      // niets anders dan zijn eigen wachtwoord wisselen tot de houder dat gedaan heeft.
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  const { count } = await prisma.session.deleteMany({ where: { accountId } });

  return { account, temporaryPassword, revokedSessions: count };
}
