import { downloadSetImages } from '../vocabulary/images.js';
import { loadManifest } from '../vocabulary/translation.js';

/**
 * `npm run vocabulary:images -- <slug>` — downloadt de afbeeldingen uit het manifest naar
 * `STORAGE_DIR` (INTENTO-NEW-DESIGN §15.1 stap 2). Een tweede run downloadt niets opnieuw.
 */
async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    console.error('Gebruik: npm run vocabulary:images -- <slug>   (bv. mulberry)');
    process.exitCode = 2;
    return;
  }
  const storageDir = process.env.STORAGE_DIR || './storage';
  const manifest = await loadManifest(slug);
  let last = 0;
  const report = await downloadSetImages(manifest, {
    storageDir,
    onProgress: (done, total) => {
      if (done - last >= 250 || done === total) {
        last = done;
        console.log(`${done}/${total}`);
      }
    },
  });
  console.log(
    `${manifest.name}: ${report.downloaded} gedownload, ${report.skipped} al aanwezig, ${report.rejected.length} geweigerd.`,
  );
  for (const { id, reason } of report.rejected) console.log(`  geweigerd ${id}: ${reason}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
