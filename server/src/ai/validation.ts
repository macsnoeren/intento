import type { PrismaClient } from '../generated/prisma/client.js';
import type { AacSymbolModel } from '../generated/prisma/models.js';
import { normalizeSearch } from '../aac/library.js';
import { createAiConcept } from '../aac/new-concept.js';
import type { OpenSymbolsClient } from '../aac/opensymbols.js';
import type { AiOption } from './provider.js';

/**
 * Validatielaag voor AI-uitvoer (T5.2/T10.6, DESIGN §7.6, §7.8, ADR-0012).
 *
 * Elke door de AI voorgestelde optie loopt door de prioriteitsvolgorde uit DESIGN §7.6:
 *
 *   1. bestaat het concept exact? → houden;
 *   2. is het een **synoniem** (of label) van een bestaand concept? → omzetten naar dat concept, houden;
 *   3. is het aantoonbaar nieuw én zijn nieuwe concepten toegestaan? → een symbool aanmaken met herkomst
 *      `ai` en status `PENDING` (inclusief pictogramzoekopdracht, `aac/new-concept.ts`), plus een
 *      `ConceptProposal` voor de beheerder. Het begrip is daarmee **wél** kiesbaar voor de gebruiker,
 *      zichtbaar gemarkeerd als nieuw woord;
 *   4. staan nieuwe concepten uit (`AI_ALLOW_NEW_CONCEPTS=false`) of is de term onbruikbaar als concept
 *      (te lang, een halve zin)? → alleen een `ConceptProposal` en de optie **weglaten**.
 *
 * Stap 1 en 2 zijn niet optioneel en gaan altijd voor: zonder die deduplicatie loopt de bibliotheek vol
 * met bijna-duplicaten die op elkaar lijken, wat het kiezen voor de gebruiker juist moeilijker maakt.
 *
 * De functie is idempotent op voorstellen: hetzelfde onbekende concept levert één openstaand
 * `ConceptProposal` op.
 */

/** Een gevalideerde, aan de bibliotheek gekoppelde optie: het echte symbool + de zekerheid. */
export interface ValidatedOption {
  symbol: AacSymbolModel;
  confidence: number;
}

/** Uitkomst van de validatie: de bruikbare opties en de onbekende concepten die zijn afgevangen. */
export interface ValidationResult {
  /** Opties die bruikbaar zijn: bestaand concept, synoniem, of een zojuist aangemaakt nieuw concept. */
  valid: ValidatedOption[];
  /** Concepten die nog niet bestonden en als `ConceptProposal` zijn vastgelegd. */
  proposed: string[];
  /**
   * De concepten die als **nieuw symbool** zijn aangemaakt (T10.6) — een deelverzameling van `proposed`.
   * De beslissingslaag heeft deze apart nodig: ze staan per definitie niet in de kandidatenset, dus de
   * "hoort dit bij dit punt"-controle moet ze doorlaten.
   */
  created: string[];
}

/** Invoer voor de validatie; bewust een object omdat er sinds T10.6 beleid en een pictogrambron bij horen. */
export interface ValidateAiOptionsInput {
  /** De door de AI voorgestelde opties, in de aangeboden volgorde. */
  options: AiOption[];
  /** De onderbouwing van de AI-beslissing; reist mee naar een eventueel `ConceptProposal`. */
  reason: string;
  /** Of de AI een concept mag aandragen dat nog niet bestaat (env `AI_ALLOW_NEW_CONCEPTS`). */
  allowNewConcepts: boolean;
  /** Pictogrambron voor een nieuw concept; `null` als de integratie uitstaat (dan de placeholder-glyph). */
  icons?: OpenSymbolsClient | null;
}

/**
 * Zoekt een bestaand symbool voor een door de AI aangedragen term. Eerst een exacte conceptmatch; anders
 * een synoniem-/labelmatch. De synoniemmatch is bewust **exact op een genormaliseerde term** (geen losse
 * `contains`), zodat een korte AI-term niet per ongeluk een onverwant symbool raakt dat het woord ergens
 * in zijn zoekindex heeft.
 */
async function resolveSymbol(prisma: PrismaClient, term: string): Promise<AacSymbolModel | null> {
  const concept = normalizeSearch(term);
  if (concept.length === 0) return null;

  const exact = await prisma.aacSymbol.findUnique({ where: { concept } });
  if (exact) return exact;

  // Synoniem/label: kandidaten waarvan de zoekindex de term bevat, daarna exact toetsen op label of
  // een van de synoniemen (genormaliseerd). Zo blijft de match betekenisvol, niet louter tekstueel.
  const candidates = await prisma.aacSymbol.findMany({
    where: { searchText: { contains: concept } },
  });
  for (const candidate of candidates) {
    if (normalizeSearch(candidate.label) === concept) return candidate;
    const synonyms = Array.isArray(candidate.synonyms) ? candidate.synonyms : [];
    if (
      synonyms.some(
        (synonym) => typeof synonym === 'string' && normalizeSearch(synonym) === concept,
      )
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * Valideert de door de AI voorgestelde opties tegen de AAC-bibliotheek (zie de moduletoelichting voor de
 * vier trappen). Bekende concepten (direct of via synoniem) blijven, ontdubbeld op symbool-id (dezelfde
 * optie tweemaal levert één keer). Een aantoonbaar nieuw begrip wordt aangemaakt als dat is toegestaan;
 * anders blijft het een voorstel zonder de gebruiker te bereiken.
 */
export async function validateAiOptions(
  prisma: PrismaClient,
  input: ValidateAiOptionsInput,
): Promise<ValidationResult> {
  const { options, reason, allowNewConcepts } = input;
  const valid: ValidatedOption[] = [];
  const seenSymbolIds = new Set<string>();
  const proposed: string[] = [];
  const created: string[] = [];
  const proposedSeen = new Set<string>();

  for (const option of options) {
    // Trap 1 + 2: bestaand concept of synoniem/label. Deze deduplicatie gaat áltijd voor.
    const symbol = await resolveSymbol(prisma, option.symbol);
    if (symbol) {
      if (!seenSymbolIds.has(symbol.id)) {
        seenSymbolIds.add(symbol.id);
        valid.push({ symbol, confidence: option.confidence });
      }
      continue;
    }

    const concept = normalizeSearch(option.symbol);
    if (concept.length === 0 || proposedSeen.has(concept)) continue;
    proposedSeen.add(concept);

    // Het begrip is nieuw: hoe dan ook vastleggen als voorstel voor de beheerder (idempotent).
    await prisma.conceptProposal.upsert({
      where: { concept },
      create: { concept, reason, status: 'PENDING' },
      // Bestaand voorstel niet overschrijven: het blijft één openstaand item (idempotent).
      update: {},
    });
    proposed.push(concept);

    // Trap 3: het begrip ook echt aanmaken zodat de gebruiker het kán kiezen (T10.6).
    if (!allowNewConcepts) continue;
    const fresh = await createAiConcept(prisma, concept, input.icons ?? null);
    if (!fresh) continue; // onbruikbare term (te lang / geen concept) → blijft alleen een voorstel
    if (seenSymbolIds.has(fresh.id)) continue;
    seenSymbolIds.add(fresh.id);
    valid.push({ symbol: fresh, confidence: option.confidence });
    created.push(fresh.concept);
  }

  return { valid, proposed, created };
}
