import type { AccountModel } from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';

/**
 * Tenant-isolatie-helpers (T1.2, DESIGN §9.4).
 *
 * Kernregel: **elke query wordt gefilterd op `organizationId`**. In plaats van dat overal
 * met de hand te herhalen (en te vergeten) geven deze helpers één plek waar de tenant-grens
 * wordt afgedwongen:
 *
 * - `tenantScope(account)` levert het `where`-fragment voor lees-/lijstqueries, zodat data
 *   van een andere organisatie nooit in het resultaat komt.
 * - `assertSameTenant(account, resource)` bewaakt directe toegang op id: hoort een gevonden
 *   record bij een andere organisatie, dan 403 (consistente foutstructuur, DESIGN §8.1).
 */

/**
 * `where`-fragment dat een query beperkt tot de organisatie van het account. Gebruik bij
 * elke lees-/lijstquery op een tenant-gebonden model, bv. `prisma.x.findMany({ where: {
 * ...tenantScope(account) } })`.
 */
export function tenantScope(account: AccountModel): { organizationId: string } {
  return { organizationId: account.organizationId };
}

/**
 * Bewaakt directe toegang tot één record: gooit 403 als het record niet bestaat óf bij een
 * andere organisatie hoort. Bewust dezelfde fout voor "bestaat niet" en "andere tenant",
 * zodat het bestaan van resources in een andere organisatie niet lekt (IDOR-mitigatie).
 */
export function assertSameTenant<T extends { organizationId: string }>(
  account: AccountModel,
  resource: T | null | undefined,
): T {
  if (!resource || resource.organizationId !== account.organizationId) {
    throw new HttpError(403, 'FORBIDDEN', 'Je hebt geen toegang tot deze resource.');
  }
  return resource;
}
