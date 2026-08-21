import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';

/**
 * Status van de organisatie als toegangsvoorwaarde (T8.3, DESIGN §9.4).
 *
 * Een platform-operator kan een organisatie **deactiveren** (`Organization.active = false`) om
 * misbruik te stoppen. Dat is bewust geen verwijdering: de gegevens blijven staan, de eigenaar
 * raakt niets kwijt en herstel is één klik. Maar het moet wél echt iets doen, anders is het een
 * label zonder werking — dus wordt de vlag afgedwongen op *alle drie* de manieren waarop iemand
 * de app binnenkomt:
 *
 * - **inloggen** (`POST /auth/login`) — geen nieuwe sessie voor een inactieve organisatie;
 * - **bestaande accountsessies** (`authorize()`) — een al ingelogde begeleider/beheerder wordt
 *   bij de eerstvolgende request geweigerd, dus deactiveren werkt onmiddellijk in plaats van pas
 *   na het verlopen van de sessie;
 * - **gekoppelde tablets** (`deviceAuthorize()`) — anders zou de gebruikersapp vrolijk door blijven
 *   praten met de AI terwijl de omgeving gestopt is.
 *
 * Kosten: één PK-lookup extra per geauthenticeerde request. Bewust een aparte, expliciete query in
 * plaats van meeliften op de sessie-join — de check moet op één plek leesbaar zijn en op elk pad
 * hetzelfde doen; een gemiste tenant is hier erger dan een index-hit.
 *
 * De **platformorganisatie** zelf kan niet worden gedeactiveerd (zie `routes/operator.ts`), zodat
 * een operator zichzelf niet buiten kan sluiten.
 */

/** Gedeelde melding: zegt wat er aan de hand is zonder details over de reden prijs te geven. */
const SUSPENDED_MESSAGE =
  'Deze omgeving is gedeactiveerd door de platformbeheerder. Neem contact op met de beheerder.';

/**
 * Gooit 403 `ORGANIZATION_SUSPENDED` als de organisatie niet (meer) actief is of niet bestaat.
 * Een ontbrekende organisatie telt als niet-actief: dat kan alleen bij een verweesde rij, en dan
 * is dichtdoen de veilige uitkomst.
 */
export async function assertOrganizationActive(
  prisma: PrismaClient,
  organizationId: string,
): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { active: true },
  });
  if (!organization?.active) {
    throw new HttpError(403, 'ORGANIZATION_SUSPENDED', SUSPENDED_MESSAGE);
  }
}

/** Of de organisatie actief is, zonder te gooien — voor paden die zelf hun fout kiezen (login). */
export async function isOrganizationActive(
  prisma: PrismaClient,
  organizationId: string,
): Promise<boolean> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { active: true },
  });
  return organization?.active === true;
}

export { SUSPENDED_MESSAGE as ORGANIZATION_SUSPENDED_MESSAGE };
