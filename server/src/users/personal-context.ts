import { personalContextCategorySchema, type PersonalContextPublic } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { PersonalContextModel } from '../generated/prisma/models.js';
import type { Encryptor } from '../crypto/encryption.js';
import type { AiUserContextItem } from '../ai/provider.js';

/**
 * Serialisatie en AI-filter voor persoonlijke context (T6.1, DESIGN §6.2, §6.3, §9.4).
 *
 * Eén plek die de **versleutelde** velden ontsleutelt: de rest van de app werkt met de leesbare vorm en
 * raakt de cijfertekst niet aan. Zo lekt plaintext PII nooit ongewild naar de db (encrypt) of naar een
 * ongefilterde AI-prompt (het toestemmingsfilter hieronder).
 */

/** Ontsleutelt een context-rij naar de publieke, leesbare vorm voor de beheer-/begeleider-API. */
export function personalContextToPublic(
  model: PersonalContextModel,
  encryptor: Encryptor,
): PersonalContextPublic {
  return {
    id: model.id,
    userId: model.userId,
    // De categorie is een gesloten taxonomie; parse dwingt dat ook bij het teruglezen af.
    category: personalContextCategorySchema.parse(model.category),
    name: encryptor.decrypt(model.nameEncrypted),
    relationship:
      model.relationshipEncrypted !== null ? encryptor.decrypt(model.relationshipEncrypted) : null,
    aiUsageAllowed: model.aiUsageAllowed,
    createdAt: model.createdAt.toISOString(),
  };
}

/**
 * Laadt de **toegestane** persoonlijke context voor de AI (DESIGN §6.3). Kernfilter van T6.1: alléén rijen
 * met `aiUsageAllowed=true` komen in het AI-contextobject — context zonder expliciete toestemming bereikt
 * de prompt nooit. De gevoelige velden worden hier pas ontsleuteld (ze staan versleuteld in de db) en
 * platgeslagen tot de gesloten `{ kind, value }`-vorm die de prompt verwacht (geen ruwe PII-blobs).
 */
export async function loadAllowedUserContext(
  prisma: PrismaClient,
  encryptor: Encryptor,
  userId: string,
): Promise<AiUserContextItem[]> {
  const rows = await prisma.personalContext.findMany({
    where: { userId, aiUsageAllowed: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => {
    const name = encryptor.decrypt(row.nameEncrypted);
    const relationship =
      row.relationshipEncrypted !== null ? encryptor.decrypt(row.relationshipEncrypted) : null;
    return {
      kind: row.category.toLowerCase(),
      value: relationship ? `${name} (${relationship})` : name,
    };
  });
}
