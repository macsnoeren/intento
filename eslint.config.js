// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Niet linten: build-output, deps, docs-sjabloon, ontwerpnaslag.
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      // Gegenereerde Prisma-client: niet linten (self-suppressed, wordt geregenereerd).
      '**/src/generated/**',
      'PROJECT-NODEJS/**',
      'INTENTO-DESIGN/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Domeinregel CLAUDE.md §6: geen `any`/`@ts-ignore` zonder expliciete reden.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
    },
  },
  {
    // Testbestanden, configs en losstaande tooling-scripts (buiten de tsconfig-`src`)
    // mogen soepeler zijn: geen type-aware linting die een tsconfig-project vereist.
    files: ['**/*.config.{js,ts}', '**/*.test.ts', '**/vitest.*.ts', '**/prisma/seed.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
);
