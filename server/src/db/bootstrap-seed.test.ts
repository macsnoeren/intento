import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from './prisma.js';
import { seedBootstrapOrgAndAdmin, BOOTSTRAP_ORGANIZATION_ID } from './bootstrap-seed.js';
import { verifyPassword } from '../auth/password.js';
import { resetAuthData } from '../test/auth-helpers.js';

/**
 * Acceptatie T1.5: de bootstrap-seed levert altijd een **geverifieerde** admin op, ook wanneer die
 * al bestond en nog ongeverifieerd was (bv. aangemaakt vóór de T1.4-migratie), en blijft
 * idempotent zonder een later gewijzigd wachtwoord te overschrijven.
 */
const OPTIONS = {
  organizationName: 'Demo-omgeving',
  adminEmail: 'admin@intento.local',
  adminPassword: 'bootstrap-wachtwoord-123',
};

describe('bootstrap-seed', () => {
  beforeEach(async () => {
    await resetAuthData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('maakt op een lege db een platformorganisatie met geverifieerde admin', async () => {
    const { organization, admin, verifiedExistingAdmin } = await seedBootstrapOrgAndAdmin(
      prisma,
      OPTIONS,
    );

    expect(organization.id).toBe(BOOTSTRAP_ORGANIZATION_ID);
    expect(organization.isPlatform).toBe(true);
    expect(admin.role).toBe('ADMIN');
    expect(admin.organizationId).toBe(organization.id);
    expect(admin.emailVerifiedAt).toBeInstanceOf(Date);
    // Vers aangemaakt: er viel niets bij te werken.
    expect(verifiedExistingAdmin).toBe(false);
    expect(await verifyPassword(admin.passwordHash, OPTIONS.adminPassword)).toBe(true);
  });

  it('verifieert een bestaande, nog ongeverifieerde bootstrap-admin alsnog', async () => {
    const { admin } = await seedBootstrapOrgAndAdmin(prisma, OPTIONS);
    // Bootst de situatie na van een admin die vóór de T1.4-migratie is aangemaakt.
    await prisma.account.update({ where: { id: admin.id }, data: { emailVerifiedAt: null } });

    const second = await seedBootstrapOrgAndAdmin(prisma, OPTIONS);

    expect(second.verifiedExistingAdmin).toBe(true);
    expect(second.admin.emailVerifiedAt).toBeInstanceOf(Date);
    const stored = await prisma.account.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('laat een later gewijzigd wachtwoord en de bestaande verificatiedatum ongemoeid', async () => {
    const { admin } = await seedBootstrapOrgAndAdmin(prisma, OPTIONS);
    const changedAt = new Date('2020-01-02T03:04:05.000Z');
    await prisma.account.update({
      where: { id: admin.id },
      data: { passwordHash: 'later-gewijzigde-hash', emailVerifiedAt: changedAt },
    });

    const second = await seedBootstrapOrgAndAdmin(prisma, {
      ...OPTIONS,
      adminPassword: 'een-heel-ander-wachtwoord',
    });

    expect(second.verifiedExistingAdmin).toBe(false);
    const stored = await prisma.account.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored.passwordHash).toBe('later-gewijzigde-hash');
    expect(stored.emailVerifiedAt?.toISOString()).toBe(changedAt.toISOString());
  });

  it('blijft idempotent: herseeden levert geen dubbele org- of accountrijen', async () => {
    const first = await seedBootstrapOrgAndAdmin(prisma, OPTIONS);
    const second = await seedBootstrapOrgAndAdmin(prisma, OPTIONS);
    await seedBootstrapOrgAndAdmin(prisma, OPTIONS);

    expect(second.admin.id).toBe(first.admin.id);
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.account.count()).toBe(1);
  });

  it('normaliseert het e-mailadres naar lowercase (één account, geen duplicaat)', async () => {
    const first = await seedBootstrapOrgAndAdmin(prisma, OPTIONS);
    const second = await seedBootstrapOrgAndAdmin(prisma, {
      ...OPTIONS,
      adminEmail: 'Admin@Intento.Local',
    });

    expect(second.admin.id).toBe(first.admin.id);
    expect(second.admin.email).toBe('admin@intento.local');
    expect(await prisma.account.count()).toBe(1);
  });
});
