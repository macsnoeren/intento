import { prisma } from '../db/prisma.js';
import { downloadSetImages } from '../vocabulary/images.js';
import { seedStartSet, START_SET_SLUGS } from '../vocabulary/seed.js';
import { loadManifest } from '../vocabulary/translation.js';

/**
 * Eenmalige import van de startset (N2.8, INTENTO-NEW-DESIGN §15.1): afbeeldingen downloaden naar
 * `STORAGE_DIR` en daarna de Vocabulary seeden. Zo draait hij in compose als klus `vocabulary-import`,
 * vóór de server start. Een tweede run downloadt niets opnieuw en maakt niets dubbel.
 *
 * Gecompileerd (`dist/scripts/vocabulary-import.js`), zodat hij ook in het productie-image draait, waar
 * `tsx` niet meer is.
 */
async function main(): Promise<void> {
  const storageDir = process.env.STORAGE_DIR || './storage';
  for (const slug of START_SET_SLUGS) {
    const manifest = await loadManifest(slug);
    const report = await downloadSetImages(manifest, { storageDir });
    console.log(
      `${manifest.name}: ${report.downloaded} gedownload, ${report.skipped} al aanwezig, ${report.rejected.length} geweigerd.`,
    );
    for (const { id, reason } of report.rejected) console.log(`  geweigerd ${id}: ${reason}`);
  }
  const reports = await seedStartSet(prisma, storageDir);
  for (const [slug, report] of Object.entries(reports)) {
    console.log(`Seed ${slug}: ${report.created} nieuw, ${report.updated} bijgewerkt.`);
  }
  const total = await prisma.vocabularyItem.count({ where: { organizationId: null } });
  console.log(`Vocabulary: ${total} platformitems.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
