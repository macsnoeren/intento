import type { PrismaClient } from '../generated/prisma/client.js';
import type { AacSymbolModel } from '../generated/prisma/models.js';
import type { OpenSymbolsClient } from './opensymbols.js';
import { buildSearchText, normalizeSearch } from './library.js';

/**
 * Aanmaken van een **nieuw, door de AI aangedragen** AAC-concept (T10.6, DESIGN §7.6 trap 3, ADR-0012).
 *
 * Tot Fase 10 gold: een concept dat niet in de bibliotheek stond, werd stilzwijgend weggelaten. Daarmee
 * zat de gebruiker vast in een woordenschat die iemand anders voor hem had bepaald — stond zijn woord er
 * niet in, dan was er geen uitweg. Nu mag de AI het begrip aandragen, onder harde voorwaarden:
 *
 *  1. **Deduplicatie gaat vóór** (trap 1/2 uit §7.6). Die controle zit in `ai/validation.ts` en draait
 *     áltijd eerst; deze module wordt pas aangeroepen als het begrip aantoonbaar nieuw is. Zonder die
 *     volgorde loopt de bibliotheek vol met bijna-duplicaten ("wandelen", "een wandeling maken"), wat het
 *     kiezen voor de gebruiker juist moeilijker maakt.
 *  2. **Meteen een pictogram.** Er wordt één zoekopdracht naar de externe pictogrambron gedaan en het
 *     eerste bruikbare resultaat gedownload (via dezelfde `https`/SSRF-guard als het beheer, ADR-0006).
 *     Lukt dat niet — geen integratie, niets gevonden, netwerkfout — dan blijft de neutrale
 *     glyph-placeholder staan. Een ontbrekend plaatje mag het gesprek nooit ophouden.
 *  3. **Zichtbaar gemarkeerd.** `origin: 'ai'` + `reviewStatus: 'PENDING'` maakt `isNew` waar in de
 *     publieke vorm, zodat de tablet het pictogram als nieuw woord toont (DESIGN §7.8: het is een
 *     aanbod, geen boodschap).
 *  4. **Onder beheer.** De beheerder ziet het in de reviewlijst (T10.7) en kan het pictogram vervangen,
 *     het label bijstellen of het samenvoegen met een bestaand symbool.
 */

/** Neutrale placeholder-glyph voor een nieuw woord zonder gevonden pictogram. */
export const NEW_CONCEPT_GLYPH = '🆕';

/**
 * Categorie van een AI-gegenereerd concept. We laten de AI géén categorie kiezen: dat zou een tweede
 * te valideren vrijheid zijn zonder dat het de gebruiker iets oplevert. `object` is de neutrale
 * verzamelbak; de beheerder zet hem desgewenst goed (T10.7).
 */
export const NEW_CONCEPT_CATEGORY = 'object';

/** Maximale lengte van een door de AI aangedragen begrip (langer is geen AAC-concept maar een zin). */
export const MAX_NEW_CONCEPT_LENGTH = 40;

/**
 * Of een door de AI aangedragen term een aanvaardbaar nieuw concept is. Bewust streng: één of twee
 * woorden, letters/cijfers/koppeltekens, niet te lang. Een model dat een halve zin als "conceptsleutel"
 * teruggeeft, produceert geen bruikbaar pictogram — dat weren we hier in plaats van het aan de gebruiker
 * te tonen.
 */
export function isAcceptableNewConcept(term: string): boolean {
  const concept = normalizeSearch(term);
  if (concept.length === 0 || concept.length > MAX_NEW_CONCEPT_LENGTH) return false;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u.test(concept)) return false;
  return concept.split(/\s+/).length <= 2;
}

/** Maakt een leesbaar label van een conceptsleutel ("nagel knippen" → "Nagel knippen"). */
export function labelForConcept(concept: string): string {
  const trimmed = concept.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** De afbeeldingsvelden die bij een gevonden pictogram op het symbool worden geschreven. */
interface IconFields {
  imageData: Buffer;
  imageMimeType: string;
  imageVersion: number;
  imageLicense: string;
  imageLicenseUrl: string | null;
  imageAuthor: string | null;
  imageAuthorUrl: string | null;
  imageSourceUrl: string | null;
}

/**
 * Zoekt één pictogram bij het begrip en geeft de te schrijven afbeeldingsvelden terug. Faalt bewust
 * **zacht**: elke fout (geen integratie, niets gevonden, time-out, onveilige URL) levert `null` op,
 * waarna de placeholder-glyph blijft staan.
 */
async function findIcon(
  icons: OpenSymbolsClient | null,
  label: string,
): Promise<IconFields | null> {
  if (!icons || !icons.isConfigured()) return null;
  try {
    const results = await icons.search(label, 'nl');
    const first = results[0];
    if (!first) return null;
    const image = await icons.fetchImage(first.imageUrl);
    return {
      imageData: Buffer.from(image.bytes),
      imageMimeType: image.contentType,
      imageVersion: 1,
      imageLicense: first.license,
      imageLicenseUrl: first.licenseUrl,
      imageAuthor: first.author,
      imageAuthorUrl: first.authorUrl,
      imageSourceUrl: first.sourceUrl,
    };
  } catch {
    // Een pictogram is een bonus, geen voorwaarde: het gesprek gaat door met de placeholder.
    return null;
  }
}

/**
 * Maakt het nieuwe symbool aan (of geeft het bestaande terug als het er intussen tóch al is — de
 * `concept`-sleutel is uniek en twee gelijktijdige gesprekken kunnen hetzelfde woord aandragen).
 * `term` is de rauwe sleutel van de AI; de aanroeper heeft al vastgesteld dat het begrip niet als
 * concept, label of synoniem bestaat.
 */
export async function createAiConcept(
  prisma: PrismaClient,
  term: string,
  icons: OpenSymbolsClient | null,
): Promise<AacSymbolModel | null> {
  if (!isAcceptableNewConcept(term)) return null;

  const concept = normalizeSearch(term);
  const existing = await prisma.aacSymbol.findUnique({ where: { concept } });
  if (existing) return existing;

  const label = labelForConcept(concept);
  const icon = await findIcon(icons, label);

  const base = {
    concept,
    label,
    category: NEW_CONCEPT_CATEGORY,
    glyph: NEW_CONCEPT_GLYPH,
    synonyms: [],
    searchText: buildSearchText({ concept, label, synonyms: [] }),
    origin: 'ai',
    reviewStatus: 'PENDING',
  };

  try {
    return await prisma.aacSymbol.create({ data: icon ? { ...base, ...icon } : base });
  } catch {
    // Race: een parallel gesprek maakte hetzelfde concept net aan. Dat is geen fout — pak het op.
    return prisma.aacSymbol.findUnique({ where: { concept } });
  }
}
