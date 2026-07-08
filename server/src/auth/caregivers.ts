import type { AccountModel } from '../generated/prisma/models.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';

/**
 * Begeleider-toegangshelper (T2.2, DESIGN §2, FR-017).
 *
 * Aanvulling op de tenant-isolatie (`tenant.ts`): naast "zelfde organisatie" geldt voor een
 * **CAREGIVER** de extra regel dat hij alléén de gebruikers mag zien/beheren waaraan hij
 * expliciet gekoppeld is. `assertCaregiverAccess` dwingt dat af op elke gebruiker-gebonden
 * route die ook voor begeleiders openstaat: is de rol CAREGIVER en ontbreekt de koppeling,
 * dan 403 (consistente foutstructuur, DESIGN §8.1). Voor ADMIN is dit een no-op — een
 * beheerder ziet alle gebruikers binnen de eigen organisatie.
 *
 * Aanname: de tenant-grens is al bewaakt (bv. via `assertSameTenant`) vóór deze aanroep, zodat
 * dit puur de begeleider-koppeling toevoegt.
 */
export async function assertCaregiverAccess(
  prisma: PrismaClient,
  account: AccountModel,
  userId: string,
): Promise<void> {
  if (account.role !== 'CAREGIVER') return;

  const link = await prisma.caregiverAssignment.findUnique({
    where: { userId_accountId: { userId, accountId: account.id } },
  });
  if (!link) {
    throw new HttpError(403, 'FORBIDDEN', 'Je bent niet gekoppeld aan deze gebruiker.');
  }
}
