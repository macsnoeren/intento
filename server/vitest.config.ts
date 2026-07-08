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
    globalSetup: ['./vitest.global-setup.ts'],
  },
});
