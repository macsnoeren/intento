import { accountPublicSchema, type AccountPublic } from '@intento/shared';
import type { AccountModel } from '../generated/prisma/models.js';

/**
 * Mapt een account naar de publieke, veilige weergave (DESIGN §8.1). Nooit de wachtwoordhash of
 * interne lockout-velden; `emailVerified` is afgeleid van `emailVerifiedAt` (T1.4) en `name` mag
 * `null` zijn (geseede accounts van vóór T1.3). Gedeeld door de auth- en account-routes zodat de
 * vorm op één plek staat en niet uit elkaar loopt.
 */
export function accountToPublic(account: AccountModel): AccountPublic {
  return accountPublicSchema.parse({
    id: account.id,
    email: account.email,
    role: account.role,
    organizationId: account.organizationId,
    name: account.name,
    emailVerified: account.emailVerifiedAt !== null,
  });
}
