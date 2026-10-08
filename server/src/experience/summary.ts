import { experienceSummarySchema, type ExperienceSummary } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * De samenvatting van de Experience die met elke beurt naar de agentdienst gaat (N12.2, §22, §29).
 *
 * Alleen ids en aantallen, nooit namen. Alleen wat er in deze beurt toe doet: symbolen uit de
 * Vocabulary die meegaat en contacten die aangeboden kunnen worden. Wat het vaakst gekozen is eerst,
 * en hooguit `MAX_SYMBOLS` symbolen, zodat het verzoek klein blijft. De aanroeper stuurt hem alleen
 * als Experience voor deze gebruiker aanstaat.
 */

/** Genoeg om de startconcepten en tegels te ordenen; de rest staat toch in de vaste volgorde. */
export const MAX_SYMBOLS = 500;

export async function experienceSummary(
  prisma: PrismaClient,
  user: { id: string; organizationId: string },
  available: { itemIds: ReadonlySet<string>; contactIds: ReadonlySet<string> },
): Promise<ExperienceSummary> {
  const rows = await prisma.experienceStat.findMany({
    where: { userId: user.id, organizationId: user.organizationId },
    orderBy: [{ chosen: 'desc' }, { subjectRef: 'asc' }],
    select: {
      subjectType: true,
      subjectRef: true,
      presented: true,
      chosen: true,
      chosenAtFirstPosition: true,
    },
  });
  const count = (row: (typeof rows)[number]) => ({
    ref: row.subjectRef,
    presented: row.presented,
    chosen: row.chosen,
    chosen_at_first_position: row.chosenAtFirstPosition,
  });
  return experienceSummarySchema.parse({
    symbols: rows
      .filter((row) => row.subjectType === 'symbol' && available.itemIds.has(row.subjectRef))
      .slice(0, MAX_SYMBOLS)
      .map(count),
    contacts: rows
      .filter((row) => row.subjectType === 'contact' && available.contactIds.has(row.subjectRef))
      .map(count),
    modes: rows.filter((row) => row.subjectType === 'mode').map(count),
  });
}
