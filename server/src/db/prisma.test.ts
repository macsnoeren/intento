import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from './prisma.js';

/**
 * Voorbeeldtest (acceptatie T0.2): schrijft en leest via Prisma in de testdatabase.
 * Bewijst dat migratie, driver adapter en client-singleton samen werken.
 */
describe('Prisma-persistentie (testdatabase)', () => {
  beforeEach(async () => {
    await prisma.organization.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('schrijft en leest een Organization terug', async () => {
    const created = await prisma.organization.create({
      data: { name: 'Testfamilie', type: 'family' },
    });

    const found = await prisma.organization.findUnique({ where: { id: created.id } });

    expect(found).not.toBeNull();
    expect(found?.name).toBe('Testfamilie');
    expect(found?.type).toBe('family');
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it('genereert automatisch een id en createdAt', async () => {
    const org = await prisma.organization.create({ data: { name: 'Zorgcentrum', type: 'care' } });

    expect(org.id.length).toBeGreaterThan(0);
    expect(await prisma.organization.count()).toBe(1);
  });
});
