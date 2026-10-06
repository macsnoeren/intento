import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetchManifest } from '../vocabulary/global-symbols.js';
import { manifestPath } from '../vocabulary/paths.js';

/**
 * `npm run vocabulary:manifest -- <slug>` — schrijft `vocabulary/sources/<slug>.manifest.json`
 * (INTENTO-NEW-DESIGN §15.1, stap 1). Voor de startset: `mulberry` en `corona-symbols`.
 */
async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    console.error('Gebruik: npm run vocabulary:manifest -- <slug>   (bv. mulberry)');
    process.exitCode = 2;
    return;
  }
  const manifest = await fetchManifest(slug, {
    onPage: (page, received, total) => console.log(`pagina ${page}: ${received}/${total}`),
  });
  const target = manifestPath(slug);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${manifest.items.length} pictos van ${manifest.name} → ${target}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
