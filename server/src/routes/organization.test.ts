import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { organizationSettingsSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { loginCookie, resetAuthData, seedAccount, testEnv } from '../test/auth-helpers.js';

/** Bewaartermijn per organisatie (N3.3, INTENTO-NEW-DESIGN §50, §53). */
describe('/organization/settings', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '1000', RETENTION_DEFAULT_DAYS: '90' }),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('geeft standaard 90 dagen, en bewaart een eigen termijn of weer de standaard', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const get = async () =>
      organizationSettingsSchema.parse(
        (
          await app.inject({ method: 'GET', url: '/organization/settings', headers: { cookie } })
        ).json(),
      );
    expect(await get()).toEqual({ retentionDays: 90, retentionDaysDefault: 90, usesDefault: true });

    const put = (retentionDays: number | null) =>
      app.inject({
        method: 'PUT',
        url: '/organization/settings',
        headers: { cookie },
        payload: { retentionDays },
      });
    expect((await put(30)).statusCode).toBe(200);
    expect(await get()).toEqual({
      retentionDays: 30,
      retentionDaysDefault: 90,
      usesDefault: false,
    });
    expect((await put(null)).json()).toMatchObject({ retentionDays: 90, usesDefault: true });

    const audit = await prisma.auditLog.findMany({
      where: { action: 'organization.settings.update' },
    });
    expect(audit).toHaveLength(2);
  });

  it('bewaakt de grenzen 7–365', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    for (const [value, status] of [
      [7, 200],
      [365, 200],
      [6, 400],
      [366, 400],
      [30.5, 400],
      ['30', 400],
    ] as const) {
      const res = await app.inject({
        method: 'PUT',
        url: '/organization/settings',
        headers: { cookie },
        payload: { retentionDays: value },
      });
      expect(res.statusCode, String(value)).toBe(status);
    }
  });

  it('is alleen voor de beheerder', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const caregiver = await seedAccount('c@intento.local', 'pw', 'CAREGIVER', admin.organizationId);
    const cookie = await loginCookie(app, caregiver.email, caregiver.password);
    expect(
      (await app.inject({ method: 'GET', url: '/organization/settings', headers: { cookie } }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/organization/settings',
          headers: { cookie },
          payload: { retentionDays: 30 },
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/organization/settings' })).statusCode).toBe(
      401,
    );
  });

  it('raakt alleen de eigen organisatie', async () => {
    const a = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const b = await seedAccount('b@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, a.email, a.password);
    await app.inject({
      method: 'PUT',
      url: '/organization/settings',
      headers: { cookie },
      payload: { retentionDays: 14 },
    });
    const other = await prisma.organization.findUniqueOrThrow({ where: { id: b.organizationId } });
    expect(other.retentionDays).toBeNull();
  });
});
