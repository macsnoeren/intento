import type { PrismaClient } from '../generated/prisma/client.js';
import type { AacSymbolModel } from '../generated/prisma/models.js';
import { normalizeSearch } from '../aac/library.js';
import type { AiOption } from './provider.js';

/**
 * Validatielaag voor AI-uitvoer (T5.2, DESIGN §7.6, §7.8).
 *
 * De AI mag tijdens communicatie **nooit** een vrij concept bij de gebruiker krijgen: elk door de AI
 * voorgesteld symbool moet bestaan in de AAC-bibliotheek. Deze laag toetst elke optie tegen de
 * bibliotheek in de prioriteitsvolgorde uit DESIGN §7.6:
 *
 *   1. bestaat het concept exact? → houden;
 *   2. is het een **synoniem** (of label) van een bestaand concept? → omzetten naar dat concept, houden;
 *   3. anders → `ConceptProposal` aanmaken (ter beoordeling door een beheerder, T7.3) en de optie
 *      **weglaten**. Het onbekende begrip bereikt de gebruiker dus nooit.
 *
 * Zo is de laag het harde vangnet achter de provider: zelfs een provider (of straks een externe worker,
 * T5.5) die een verzonnen concept teruggeeft, kan de AAC-begrenzing niet doorbreken. De functie is
 * idempotent op voorstellen: hetzelfde onbekende concept levert één openstaand `ConceptProposal` op.
 */

/** Een gevalideerde, aan de bibliotheek gekoppelde optie: het echte symbool + de zekerheid. */
export interface ValidatedOption {
  symbol: AacSymbolModel;
  confidence: number;
}

/** Uitkomst van de validatie: de bruikbare opties en de onbekende concepten die zijn afgevangen. */
export interface ValidationResult {
  /** Opties die bestaan in de bibliotheek (concept of synoniem), in de aangeboden volgorde. */
  valid: ValidatedOption[];
  /** Concepten die niet bestonden en als `ConceptProposal` zijn vastgelegd (en weggelaten). */
  proposed: string[];
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
 * Valideert de door de AI voorgestelde opties tegen de AAC-bibliotheek. Onbekende concepten worden als
 * `ConceptProposal` vastgelegd en weggelaten; bekende concepten (direct of via synoniem) blijven,
 * ontdubbeld op symbool-id (dezelfde optie tweemaal levert één keer). `reason` is de onderbouwing van de
 * AI-beslissing en reist mee naar het voorstel.
 */
export async function validateAiOptions(
  prisma: PrismaClient,
  options: AiOption[],
  reason: string,
): Promise<ValidationResult> {
  const valid: ValidatedOption[] = [];
  const seenSymbolIds = new Set<string>();
  const proposed: string[] = [];
  const proposedSeen = new Set<string>();

  for (const option of options) {
    const symbol = await resolveSymbol(prisma, option.symbol);
    if (symbol) {
      if (!seenSymbolIds.has(symbol.id)) {
        seenSymbolIds.add(symbol.id);
        valid.push({ symbol, confidence: option.confidence });
      }
      continue;
    }

    // Onbekend concept: vastleggen als voorstel (idempotent op concept) en weglaten.
    const concept = normalizeSearch(option.symbol);
    if (concept.length === 0 || proposedSeen.has(concept)) continue;
    proposedSeen.add(concept);
    await prisma.conceptProposal.upsert({
      where: { concept },
      create: { concept, reason, status: 'PENDING' },
      // Bestaand voorstel niet overschrijven: het blijft één openstaand item (idempotent).
      update: {},
    });
    proposed.push(concept);
  }

  return { valid, proposed };
}
