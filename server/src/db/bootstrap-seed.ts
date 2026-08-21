import { hashPassword } from '../auth/password.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel, OrganizationModel } from '../generated/prisma/models.js';

/**
 * Bootstrap-seed: de platform-/operatororganisatie en het eerste ADMIN-account (T1.1, T1.5).
 *
 * Staat bewust in `src/` (en niet alleen in `prisma/seed.ts`) zodat het seed-script en de tests
 * dezelfde code draaien — het idempotentie-gedrag hieronder is precies wat getest moet worden.
 */

export interface BootstrapSeedOptions {
  /** Vaste id van de bootstrap-organisatie; maakt herseeden idempotent zonder unieke naam. */
  organizationId?: string;
  organizationName?: string;
  organizationType?: string;
  /** Login van de bootstrap-admin (lowercase genormaliseerd, net als op de API-grens). */
  adminEmail: string;
  /** Alleen gebruikt bij het **aanmaken**; een bestaand wachtwoord blijft ongemoeid. */
  adminPassword: string;
}

export interface BootstrapSeedResult {
  organization: OrganizationModel;
  admin: AccountModel;
  /** True als deze seedrun een bestaande, nog niet geverifieerde admin alsnog heeft geverifieerd. */
  verifiedExistingAdmin: boolean;
}

export const BOOTSTRAP_ORGANIZATION_ID = 'seed-demo-org';

/**
 * Zet de bootstrap-organisatie en -admin neer. Idempotent: herhaald draaien levert geen dubbele
 * rijen en overschrijft geen later gewijzigd wachtwoord.
 *
 * **Verificatie (T1.5).** Een bootstrap-admin wordt door de operator zelf geseed en heeft geen
 * publieke zelfaanmelding doorlopen; hij is daarom per definitie geverifieerd (T1.4). Bij een
 * *bestaand* account zetten we `emailVerifiedAt` daarom alsnog — maar **alleen wanneer die `null`
 * is** (gerichte `updateMany`), zodat een admin die vóór de T1.4-migratie is aangemaakt na
 * herseeden niet ongeverifieerd achterblijft en de oorspronkelijke verificatiedatum van een al
 * geverifieerd account niet wordt verschoven. Het wachtwoord blijft ongemoeid.
 *
 * **Operator (T8.3).** De bootstrap-admin is óók de platform-operator: hij mag via `/operator` over
 * tenants heen organisaties beheren. Dat is bewust de *enige* plek waar `isOperator` gezet wordt —
 * er is geen API om de vlag uit te delen, dus niemand kan zichzelf naar de console promoveren. Ook
 * bij herseeden gezet (net als `isPlatform` op de organisatie), zodat een omgeving die vóór T8.3 is
 * geseed na een herseed een werkende console heeft.
 */
export async function seedBootstrapOrgAndAdmin(
  prisma: PrismaClient,
  options: BootstrapSeedOptions,
): Promise<BootstrapSeedResult> {
  const organizationId = options.organizationId ?? BOOTSTRAP_ORGANIZATION_ID;
  const email = options.adminEmail.toLowerCase();

  const organization = await prisma.organization.upsert({
    where: { id: organizationId },
    // De bootstrap-org is de **platform-/operatororganisatie** (T5.8): alleen ADMINs hiervan
    // mogen worker-tokens (infrastructuur-credentials) beheren. Ook bij herseeden gezet.
    // Ook `active` (T8.3): de platformorganisatie kan niet gedeactiveerd worden, en een herseed zet
    // een handmatig gewijzigde rij weer goed.
    update: { isPlatform: true, active: true },
    create: {
      id: organizationId,
      name: options.organizationName ?? 'Demo-omgeving',
      type: options.organizationType ?? 'family',
      isPlatform: true,
    },
  });

  const verifiedAt = new Date();
  const created = await prisma.account.upsert({
    where: { email },
    // Wachtwoord bij herseeden niet overschrijven (respecteert een later gewijzigd wachtwoord).
    // De operatorvlag wél: die hoort onlosmakelijk bij de bootstrap-admin (T8.3).
    update: { isOperator: true },
    create: {
      email,
      passwordHash: await hashPassword(options.adminPassword),
      role: 'ADMIN',
      organizationId: organization.id,
      // Bootstrap-admin: meteen geverifieerd zodat alle beheeracties direct beschikbaar zijn (T1.4).
      emailVerifiedAt: verifiedAt,
      // Platform-operator (T8.3): mag de cross-tenant console gebruiken.
      isOperator: true,
    },
  });

  // Alléén een nog-ongeverifieerde bestaande admin bijwerken (zie doc-comment hierboven).
  const { count } = await prisma.account.updateMany({
    where: { id: created.id, emailVerifiedAt: null },
    data: { emailVerifiedAt: verifiedAt },
  });

  return {
    organization,
    admin: count > 0 ? { ...created, emailVerifiedAt: verifiedAt } : created,
    verifiedExistingAdmin: count > 0,
  };
}
