import { z } from 'zod';

/**
 * De lopende **hypothese** van de AI over wat de gebruiker bedoelt (T10.8, DESIGN §7.1 taak 3, §7.4).
 *
 * **Waarom dit bestaat.** Tot Fase 10 was er nergens vastgelegd wát de AI dacht dat de gebruiker wilde.
 * Er was alleen een pad van gekozen concepten en een losse `confidence` per stap, rauw uit één
 * modelantwoord. Twee gevolgen:
 *
 *  - De voorsteldrempel (>85%, §7.4) vuurde op één enkel antwoord. Een model dat toevallig één keer
 *    zelfverzekerd was, sprong meteen naar een boodschap — precies het "voorstel uit het niets" uit de
 *    gebruikerstest.
 *  - De correctieflow (§3.4) moest de misstap raden via de *laagste* per-stap-zekerheid als proxy.
 *
 * **Wat de hypothese doet.** Ze houdt per beurt bij welke concepten de AI als bedoeling ziet, met een
 * zekerheid die over beurten heen wordt **gedempt** in plaats van overschreven, plus de geschiedenis
 * daarvan. Daarmee wordt de voorsteldrempel stabiel en kan de correctie het punt aanwijzen waar de
 * hypothese **kantelde** (de sterkste daling), in plaats van het punt waar het model toevallig het
 * laagst scoorde.
 *
 * **Privacy.** Uitsluitend AAC-concepten, getallen en de onderbouwing van de AI — nooit persoonlijke
 * context (DESIGN §9.4). En bewust **vluchtig**: bij `/confirm` wordt de hypothese gewist, want een
 * onzekere aanname is geen bewaarde communicatie (DESIGN §3.6).
 */

/**
 * Gewicht van het nieuwste modelantwoord in de gedempte zekerheid. 0,6 laat nieuwe informatie duidelijk
 * doorwerken (de gebruiker moet vooruitgang merken) maar zorgt dat één uitschieter de voorsteldrempel
 * niet alleen kan halen: vanaf een neutrale 0,7 tilt één antwoord van 0,95 de hypothese naar 0,85 —
 * precies de grens — en pas een tweede bevestiging brengt hem er duidelijk overheen.
 */
export const HYPOTHESIS_SMOOTHING = 0.6;

/** Maximaal aantal bewaarde hypothese-punten; genoeg voor de correctie-analyse, begrensd qua omvang. */
export const HYPOTHESIS_HISTORY_LIMIT = 20;

/** Eén meetpunt in de hypothesegeschiedenis: bij hoeveel stappen, met welke zekerheid en welk beeld. */
export const hypothesisEntrySchema = z.object({
  /** Het aantal gezette stappen op het moment van deze meting (= de index van de volgende stap). */
  stepCount: z.number().int().min(0),
  /** De **gedempte** zekerheid na deze beurt. */
  confidence: z.number().min(0).max(1),
  /** De concepten die de AI op dat moment als bedoeling zag. */
  concepts: z.array(z.string()),
});
export type HypothesisEntry = z.infer<typeof hypothesisEntrySchema>;

/** De hypothese zoals ze op de sessie wordt bewaard (Json-kolom; bij het lezen hiermee gevalideerd). */
export const hypothesisSchema = z.object({
  /** De concepten die de AI nu als bedoeling ziet (de laatst voorgestelde opties). */
  concepts: z.array(z.string()),
  /** De gedempte interpretatie-zekerheid (§7.4 wordt hierop toegepast). */
  confidence: z.number().min(0).max(1),
  /** De onderbouwing van de AI bij de laatste beurt (vrije tekst uit de provider). */
  reason: z.string(),
  /** De geschiedenis, oplopend op `stepCount`. */
  history: z.array(hypothesisEntrySchema),
});
export type Hypothesis = z.infer<typeof hypothesisSchema>;

/**
 * Leest een op de sessie bewaarde hypothese. Geeft `null` bij afwezigheid **of** een vorm die niet
 * klopt — een oude/corrupte blob mag de flow nooit laten falen; dan begint de hypothese gewoon opnieuw.
 */
export function readHypothesis(value: unknown): Hypothesis | null {
  if (value === null || value === undefined) return null;
  const parsed = hypothesisSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Werkt de hypothese bij met het resultaat van een nieuwe beurt. De zekerheid wordt **gedempt** ten
 * opzichte van de vorige (zie `HYPOTHESIS_SMOOTHING`); is er nog geen hypothese, dan telt het rauwe
 * antwoord volledig — aan het begin is er niets om tegen af te wegen.
 */
export function updateHypothesis(
  previous: Hypothesis | null,
  next: { stepCount: number; rawConfidence: number; concepts: string[]; reason: string },
): Hypothesis {
  const confidence =
    previous === null
      ? next.rawConfidence
      : previous.confidence * (1 - HYPOTHESIS_SMOOTHING) +
        next.rawConfidence * HYPOTHESIS_SMOOTHING;

  const entry: HypothesisEntry = {
    stepCount: next.stepCount,
    confidence,
    concepts: next.concepts,
  };
  // Eén meetpunt per stapstand: een herberekening van dezelfde beurt (bv. na `/back`) overschrijft.
  const history = [
    ...(previous?.history ?? []).filter((e) => e.stepCount !== next.stepCount),
    entry,
  ]
    .sort((a, b) => a.stepCount - b.stepCount)
    .slice(-HYPOTHESIS_HISTORY_LIMIT);

  return { concepts: next.concepts, confidence, reason: next.reason, history };
}

/**
 * Zoekt het **kantelpunt** in de hypothese: de stapstand waar de zekerheid het sterkst daalde. Dat is
 * het punt waar de AI het meest van gedachten veranderde en dus de meest waarschijnlijke misstap
 * (DESIGN §3.4). Geeft `null` als er geen daling in de geschiedenis zit — dan valt de correctie terug op
 * de bestaande per-stap-analyse.
 */
export function tippingPoint(hypothesis: Hypothesis | null): number | null {
  const history = hypothesis?.history ?? [];
  if (history.length < 2) return null;

  let worstDrop = 0;
  let atStepCount: number | null = null;
  for (let index = 1; index < history.length; index++) {
    const drop = history[index - 1]!.confidence - history[index]!.confidence;
    // Strikt groter → de vroegste van twee gelijke dalingen wint (dichter bij de wortel van het
    // misverstand, net als in `analyzeCorrection`).
    if (drop > worstDrop) {
      worstDrop = drop;
      atStepCount = history[index]!.stepCount;
    }
  }
  // De meting bij `stepCount` hoort bij de keuze die er dáárvoor gezet is: stap `stepCount - 1`.
  return atStepCount === null ? null : Math.max(0, atStepCount - 1);
}
