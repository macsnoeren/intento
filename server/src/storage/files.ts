import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Bestandsopslag voor de afbeeldingen van de Vocabulary (INTENTO-NEW-DESIGN §53).
 *
 * De bestanden staan in `STORAGE_DIR`, buiten de webroot; ze zijn alleen bereikbaar via
 * `GET /assets/:id` met een ondertekende URL. Een opgeslagen pad is altijd **relatief** aan de
 * opslagmap, en wordt bij elk gebruik opnieuw gecontroleerd: een pad dat buiten de map uitkomt
 * (`../`, absoluut) wordt geweigerd, ook als het uit de eigen database komt.
 */

export class StoragePathError extends Error {
  constructor(path: string) {
    super(`Ongeldig opslagpad: ${path}`);
    this.name = 'StoragePathError';
  }
}

/** Het absolute pad van `assetPath` binnen `storageDir`; gooit als het erbuiten zou uitkomen. */
export function resolveStoragePath(storageDir: string, assetPath: string): string {
  if (!assetPath || isAbsolute(assetPath) || assetPath.includes('\0')) {
    throw new StoragePathError(assetPath);
  }
  const root = resolve(storageDir);
  const full = resolve(root, assetPath);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new StoragePathError(assetPath);
  }
  return full;
}

/** Leest een opgeslagen bestand. */
export function readStoredFile(storageDir: string, assetPath: string): Promise<Buffer> {
  return readFile(resolveStoragePath(storageDir, assetPath));
}

/**
 * Schrijft een bestand atomair: eerst naar een tijdelijk bestand ernaast, dan hernoemen. Zo staat er
 * nooit een half geschreven afbeelding op de plek waar de server hem zoekt.
 */
export async function writeStoredFile(
  storageDir: string,
  assetPath: string,
  bytes: Uint8Array,
): Promise<void> {
  const full = resolveStoragePath(storageDir, assetPath);
  await mkdir(dirname(full), { recursive: true });
  const temp = `${full}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, full);
}
