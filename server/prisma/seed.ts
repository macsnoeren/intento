import { prisma } from '../src/db/prisma.js';

/**
 * Seed-skelet (T0.2).
 *
 * Draaibaar en idempotent via `npm run db:seed`. Nu alleen een demo-organisatie zodat de
 * workflow staat; echte seed-data (eerste admin-account in T1.1, AAC-bibliotheek in T3.1)
 * wordt hier in latere taken aan toegevoegd. Idempotent via een vaste id, zodat herhaald
 * seeden geen dubbele rijen oplevert.
 */
async function main(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { id: 'seed-demo-org' },
    update: {},
    create: { id: 'seed-demo-org', name: 'Demo-omgeving', type: 'family' },
  });

  console.log(`Seed klaar: organisatie "${org.name}" (${org.id}).`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed mislukt:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
