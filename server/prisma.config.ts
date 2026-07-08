import { defineConfig } from 'prisma/config';

/**
 * Prisma 7-configuratie (vervangt de `url` in schema.prisma, die in v7 niet meer mag).
 *
 * De CLI (`migrate`, `db seed`, `studio`) leest de verbinding hier; de runtime-client
 * krijgt zijn verbinding via een driver adapter (zie src/db/prisma.ts). We houden beide
 * op dezelfde `DATABASE_URL` zodat migreren en draaien tegen dezelfde database gebeuren.
 *
 * Dev/test draaien op SQLite; productie op PostgreSQL (ADR-0003). De dev-default zorgt
 * dat CLI-commando's out-of-the-box werken zonder een .env; env-variabelen (of het
 * `DATABASE_URL` dat de testrunner meegeeft) hebben altijd voorrang.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
  },
  migrations: {
    path: 'prisma/migrations',
    // Skelet-seed (T0.2); wordt in latere taken met echte data gevuld.
    seed: 'tsx prisma/seed.ts',
  },
});
