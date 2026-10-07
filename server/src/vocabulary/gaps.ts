import type { VocabularyGap } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Ontbrekende woorden (Vocabulary gaps, INTENTO-NEW-DESIGN §17, §39).
 *
 * De agentdienst meldt per beurt welke betekenissen de Vocabulary niet goed dekt. De backend voegt die
 * samen **per concept per organisatie**: één regel voor "duizelig", met hoe vaak en wanneer het laatst,
 * het woord, de context en het beste pictogram van de laatste keer. Er gaat bewust geen gebruiker of
 * gesprek mee, zodat de lijst voor de beheerder geen persoonlijke inhoud bevat.
 *
 * Het beste pictogram is al door de invarianten gecontroleerd (het staat in de Vocabulary van deze
 * organisatie); de backend vertrouwt verder niets uit het antwoord.
 */

export const GAP_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

/**
 * Legt de gaps van één beurt vast. Hetzelfde concept twee keer in één beurt telt als één keer (de laatste
 * melding wint). Een opgelost woord dat toch weer voorkomt, gaat terug naar `open`; een genegeerd woord
 * blijft genegeerd. Geeft de concepten terug die nieuw zijn voor deze organisatie.
 */
export async function recordGaps(
  prisma: PrismaClient,
  organizationId: string,
  gaps: readonly VocabularyGap[],
  now: Date,
): Promise<string[]> {
  const byConcept = new Map(gaps.map((gap) => [gap.concept, gap]));
  const created: string[] = [];
  for (const gap of byConcept.values()) {
    const latest = {
      label: gap.label.trim(),
      context: gap.context ?? null,
      bestAvailableItemId: gap.best_available_item_id ?? null,
      lastConfidence: gap.confidence,
      lastSeenAt: now,
    };
    const row = await prisma.vocabularyGap.upsert({
      where: { organizationId_conceptKey: { organizationId, conceptKey: gap.concept } },
      create: { organizationId, conceptKey: gap.concept, ...latest, firstSeenAt: now },
      update: { ...latest, occurrences: { increment: 1 } },
      select: { occurrences: true },
    });
    if (row.occurrences === 1) created.push(gap.concept);
    await prisma.vocabularyGap.updateMany({
      where: { organizationId, conceptKey: gap.concept, status: 'resolved' },
      data: { status: 'open' },
    });
  }
  return created;
}
