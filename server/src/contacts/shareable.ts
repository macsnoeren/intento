import type { ContactEntry } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Encryptor } from '../crypto/encryption.js';

/**
 * De contacten die de agentdienst mag aanbieden (N11.1, INTENTO-NEW-DESIGN §28, §31): alleen van deze
 * gebruiker, actief en **bevestigd** (opt-in, V5), in de vaste volgorde. Per contact het id, de naam
 * (voor de vaste zinnen), het pictogram en de volgorde — nooit het e-mailadres (V6). Een pictogram dat
 * niet (meer) in de bruikbare Vocabulary staat, gaat niet mee.
 */
export async function listShareableContacts(
  prisma: PrismaClient,
  encryptor: Encryptor,
  user: { id: string; organizationId: string },
  vocabulary: ReadonlyMap<string, unknown>,
): Promise<ContactEntry[]> {
  const rows = await prisma.contact.findMany({
    where: {
      userId: user.id,
      organizationId: user.organizationId,
      active: true,
      emailVerifiedAt: { not: null },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, nameEncrypted: true, vocabularyItemId: true, sortOrder: true },
  });
  return rows.map((row) => ({
    id: row.id,
    name: encryptor.decrypt(row.nameEncrypted),
    vocabulary_item_id:
      row.vocabularyItemId && vocabulary.has(row.vocabularyItemId) ? row.vocabularyItemId : null,
    sort_order: row.sortOrder,
  }));
}
