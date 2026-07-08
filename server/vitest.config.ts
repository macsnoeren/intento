import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Alle tests draaien tegen een gescheiden SQLite-testdatabase (relatief aan de
    // server-CWD). De global setup migreert die verse db per testrun.
    env: {
      DATABASE_URL: 'file:./prisma/test.db',
    },
    // Alle testbestanden delen één SQLite-testdatabase; draai ze daarom serieel zodat
    // db-schrijvende tests elkaar niet in de rede vallen (locks/kruislingse cleanup).
    fileParallelism: false,
    globalSetup: ['./vitest.global-setup.ts'],
  },
});
