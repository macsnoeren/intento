import { prisma } from '../src/db/prisma.js';
import { seedBootstrapOrgAndAdmin } from '../src/db/bootstrap-seed.js';
import { seedAacLibrary } from '../src/aac/library.js';

/**
 * Seed-script (idempotent, `npm run db:seed`).
 *
 * Zet de minimale startdata neer: één demo-/platformorganisatie en een eerste ADMIN-account, zodat
 * je direct kunt inloggen en de rest van de beheerflow kunt bouwen (T1.1). Idempotent via vaste id /
 * unieke e-mail, zodat herhaald seeden geen dubbele rijen oplevert. De feitelijke logica staat in
 * `src/db/bootstrap-seed.ts` zodat script en tests dezelfde code draaien.
 *
 * Bij herseeden blijft het wachtwoord ongemoeid (een later gewijzigd wachtwoord blijft geldig),
 * maar een nog **ongeverifieerde** bootstrap-admin wordt alsnog geverifieerd (T1.5): zo'n account is
 * door de operator geseed en heeft geen zelfaanmelding doorlopen, en zou anders — bijvoorbeeld
 * aangemaakt vóór de T1.4-migratie — op de verificatie-gate blijven hangen.
 *
 * Het admin-wachtwoord komt uit `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (env). Er is een
 * dev-default zodat lokaal seeden werkt; in een gedeelde/productie-omgeving MOET je die
 * overschrijven — het script waarschuwt als de default wordt gebruikt.
 */
const DEV_DEFAULT_PASSWORD = 'change-me-admin';
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@intento.local').toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? DEV_DEFAULT_PASSWORD;

async function main(): Promise<void> {
  const { organization, admin, verifiedExistingAdmin } = await seedBootstrapOrgAndAdmin(prisma, {
    organizationName: 'Demo-omgeving',
    adminEmail,
    adminPassword,
  });

  // AAC-bibliotheek (T3.1): gedeelde, niet-tenant-gebonden woordenschat. Idempotent ge-upsert.
  await seedAacLibrary(prisma);
  const symbolCount = await prisma.aacSymbol.count();

  console.log(
    `Seed klaar: organisatie "${organization.name}" (${organization.id}), admin "${admin.email}", ${symbolCount} AAC-symbolen.`,
  );
  if (verifiedExistingAdmin) {
    console.log(
      'ℹ️  Bestaande bootstrap-admin was nog niet geverifieerd — nu alsnog geverifieerd.',
    );
  }
  if (adminPassword === DEV_DEFAULT_PASSWORD) {
    console.warn(
      '⚠️  SEED_ADMIN_PASSWORD niet gezet — dev-default gebruikt. Zet een echt wachtwoord buiten lokale ontwikkeling.',
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error('Seed mislukt:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
