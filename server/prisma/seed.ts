import { prisma } from '../src/db/prisma.js';
import { hashPassword } from '../src/auth/password.js';
import { seedAacLibrary } from '../src/aac/library.js';

/**
 * Seed-script (idempotent, `npm run db:seed`).
 *
 * Zet de minimale startdata neer: één demo-organisatie en een eerste ADMIN-account, zodat
 * je direct kunt inloggen en de rest van de beheerflow kunt bouwen (T1.1). Idempotent via
 * vaste id / unieke e-mail, zodat herhaald seeden geen dubbele rijen oplevert.
 *
 * Het admin-wachtwoord komt uit `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (env). Er is een
 * dev-default zodat lokaal seeden werkt; in een gedeelde/productie-omgeving MOET je die
 * overschrijven — het script waarschuwt als de default wordt gebruikt.
 */
const DEV_DEFAULT_PASSWORD = 'change-me-admin';
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@intento.local').toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? DEV_DEFAULT_PASSWORD;

async function main(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { id: 'seed-demo-org' },
    // De bootstrap-org is de **platform-/operatororganisatie** (T5.8): alleen ADMINs hiervan
    // mogen worker-tokens (infrastructuur-credentials) beheren. Ook bij herseeden gezet.
    update: { isPlatform: true },
    create: { id: 'seed-demo-org', name: 'Demo-omgeving', type: 'family', isPlatform: true },
  });

  const passwordHash = await hashPassword(adminPassword);
  const admin = await prisma.account.upsert({
    where: { email: adminEmail },
    // Wachtwoord bij herseeden niet overschrijven (respecteert een later gewijzigd wachtwoord).
    update: {},
    create: {
      email: adminEmail,
      passwordHash,
      role: 'ADMIN',
      organizationId: org.id,
      // Bootstrap-admin (door de operator geseed, niet via publieke zelfaanmelding): meteen
      // geverifieerd zodat alle beheeracties direct beschikbaar zijn (T1.4).
      emailVerifiedAt: new Date(),
    },
  });

  // AAC-bibliotheek (T3.1): gedeelde, niet-tenant-gebonden woordenschat. Idempotent ge-upsert.
  await seedAacLibrary(prisma);
  const symbolCount = await prisma.aacSymbol.count();

  console.log(
    `Seed klaar: organisatie "${org.name}" (${org.id}), admin "${admin.email}", ${symbolCount} AAC-symbolen.`,
  );
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
