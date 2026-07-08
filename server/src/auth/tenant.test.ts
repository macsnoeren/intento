import { describe, expect, it } from 'vitest';
import type { AccountModel } from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { assertSameTenant, tenantScope } from './tenant.js';

/** Minimale account-stub; alleen `organizationId` telt voor de tenant-helpers. */
function accountIn(organizationId: string): AccountModel {
  return { organizationId } as AccountModel;
}

describe('tenantScope', () => {
  it('levert een where-fragment gefilterd op de organisatie van het account', () => {
    expect(tenantScope(accountIn('org-a'))).toEqual({ organizationId: 'org-a' });
  });
});

describe('assertSameTenant', () => {
  it('geeft het record terug als het bij dezelfde organisatie hoort', () => {
    const resource = { organizationId: 'org-a', value: 42 };
    expect(assertSameTenant(accountIn('org-a'), resource)).toBe(resource);
  });

  it('gooit 403 FORBIDDEN bij een record uit een andere organisatie', () => {
    expect(() => assertSameTenant(accountIn('org-a'), { organizationId: 'org-b' })).toThrow(
      HttpError,
    );
    try {
      assertSameTenant(accountIn('org-a'), { organizationId: 'org-b' });
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(403);
      expect((err as HttpError).code).toBe('FORBIDDEN');
    }
  });

  it('gooit dezelfde 403 bij een ontbrekend record (lekt geen bestaan)', () => {
    try {
      assertSameTenant(accountIn('org-a'), null);
      throw new Error('had moeten gooien');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(403);
    }
  });
});
