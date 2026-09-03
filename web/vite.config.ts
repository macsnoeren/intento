import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Onder welk pad de app gepubliceerd wordt. Standaard de site-root; achter een reverse proxy die de
 * app onder een prefix hangt (`https://host/intento/`) moet Vite dat pad in de bundel bakken, anders
 * vraagt `index.html` zijn assets op onder `/assets/…` en staat daar niets.
 *
 * Build-time, niet runtime: het pad zit in de gegenereerde `index.html` en in elke dynamische import.
 * Wijzig je het, dan hoort daar een nieuwe build bij. In de app zelf lees je hem terug als
 * `import.meta.env.BASE_URL` — gebruik die en nooit een hardgecodeerde `/`-link.
 *
 * Moet met een `/` beginnen en eindigen; Vite eist dat en een pad zonder sluitende slash levert
 * `/intentoassets/…` op.
 */
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
