import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

/**
 * Vitest global setup: verse SQLite-testdatabase per testrun (acceptatie T0.2).
 *
 * Verwijdert een eventuele oude testdatabase en past alle migraties opnieuw toe met
 * `prisma migrate deploy`. Zo draaien tests altijd tegen een schone db die exact het
 * migratieschema volgt — gescheiden van de dev-database (`prisma/dev.db`). De runtime
 * (Prisma-client in de tests) leest dezelfde `DATABASE_URL` via `vitest.config.ts`.
 */
const TEST_DATABASE_URL = 'file:./prisma/test.db';

export default function setup(): void {
  for (const file of ['prisma/test.db', 'prisma/test.db-journal']) {
    if (existsSync(file)) rmSync(file);
  }

  try {
    execSync('npx prisma migrate deploy', {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });
  } catch (error) {
    const err = error as { stdout?: Buffer; stderr?: Buffer };
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    throw new Error('Migreren van de testdatabase is mislukt (zie output hierboven).', {
      cause: error,
    });
  }
}
