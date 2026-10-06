/**
 * Licenties van externe symbolen (INTENTO-NEW-DESIGN §15).
 *
 * Externe bronnen (OpenSymbols, Global Symbols) noemen hun licentie in vrije tekst ("CC BY-SA",
 * "Creative Commons Attribution-ShareAlike 3.0", "public domain", …) en soms met een URL. Hier wordt
 * dat een vaste sleutel: `CC0`, of `CC-<onderdelen>-<versie>` zoals `CC-BY-SA-4.0`. Wat niet herkend
 * wordt, is `UNKNOWN` — en dus nooit toegestaan.
 *
 * Welke **families** (zonder versie) zijn toegestaan, bepaalt `VOCABULARY_ALLOWED_LICENSES`
 * (standaard CC0, CC BY en CC BY-SA). Niet-commercieel (NC) en geen bewerkingen (ND) vallen daar
 * standaard buiten: Intento toont symbolen met een eigen woord eronder.
 */

export const LICENSE_FAMILIES = [
  'CC0',
  'CC-BY',
  'CC-BY-SA',
  'CC-BY-NC',
  'CC-BY-NC-SA',
  'CC-BY-ND',
  'CC-BY-NC-ND',
] as const;
export type LicenseFamily = (typeof LICENSE_FAMILIES)[number];

export const DEFAULT_ALLOWED_LICENSES: LicenseFamily[] = ['CC0', 'CC-BY', 'CC-BY-SA'];

export interface NormalizedLicense {
  /** Vaste sleutel zoals in `VocabularyItem.licenseKey`, of `UNKNOWN`. */
  key: string;
  family: LicenseFamily | null;
}

const UNKNOWN: NormalizedLicense = { key: 'UNKNOWN', family: null };

function family(parts: Set<string>): LicenseFamily | null {
  if (!parts.has('BY')) return null;
  const name = ['CC', 'BY', ...['NC', 'SA', 'ND'].filter((p) => parts.has(p))].join('-');
  // SA én ND tegelijk bestaat niet.
  return (LICENSE_FAMILIES as readonly string[]).includes(name) ? (name as LicenseFamily) : null;
}

function withVersion(f: LicenseFamily, version: string | undefined): NormalizedLicense {
  if (f === 'CC0') return { key: 'CC0', family: 'CC0' };
  return { key: version ? `${f}-${version}` : f, family: f };
}

/** Zet een licentietekst (en eventueel URL) om naar een vaste sleutel. */
export function normalizeLicense(
  text: string | null | undefined,
  url?: string | null,
): NormalizedLicense {
  const raw = `${text ?? ''} ${url ?? ''}`.toLowerCase();
  if (!raw.trim()) return UNKNOWN;
  if (/\bcc0\b|cc-zero|publicdomain\/zero|public[\s-]*domain/.test(raw)) {
    return { key: 'CC0', family: 'CC0' };
  }

  // De URL is het betrouwbaarst: creativecommons.org/licenses/by-sa/3.0/
  const fromUrl = /creativecommons\.org\/licenses\/([a-z-]+)\/(\d+(?:\.\d+)?)/.exec(raw);
  if (fromUrl?.[1]) {
    const f = family(new Set(fromUrl[1].toUpperCase().split('-')));
    return f ? withVersion(f, fromUrl[2]) : UNKNOWN;
  }

  if (!/\bcc\b|creative\s*commons/.test(raw)) return UNKNOWN;
  const parts = new Set<string>();
  if (/attribution|\bby\b/.test(raw)) parts.add('BY');
  if (/share[\s-]*alike|\bsa\b/.test(raw)) parts.add('SA');
  if (/non[\s-]*commercial|\bnc\b/.test(raw)) parts.add('NC');
  if (/no[\s-]*deriv|\bnd\b/.test(raw)) parts.add('ND');
  const f = family(parts);
  if (!f) return UNKNOWN;
  const version = /\b(\d\.\d)\b/.exec(raw)?.[1];
  return withVersion(f, version);
}

/** De familie van een opgeslagen sleutel (`CC-BY-SA-4.0` → `CC-BY-SA`), of `null`. */
export function licenseFamily(key: string): LicenseFamily | null {
  if (key === 'CC0') return 'CC0';
  const withoutVersion = key.replace(/-\d+(?:\.\d+)?$/, '');
  return (LICENSE_FAMILIES as readonly string[]).includes(withoutVersion)
    ? (withoutVersion as LicenseFamily)
    : null;
}

/** Mag een symbool met deze licentie in de Vocabulary? Onbekend is nooit toegestaan. */
export function isLicenseAllowed(
  license: NormalizedLicense | string,
  allowed: readonly LicenseFamily[],
): boolean {
  const f = typeof license === 'string' ? licenseFamily(license) : license.family;
  return f !== null && allowed.includes(f);
}
