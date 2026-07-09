import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { resetAuthData, seedAccount } from '../test/auth-helpers.js';
import {
  buildVerificationUrl,
  createEmailVerificationToken,
  hashVerificationToken,
  verifyEmailToken,
} from './email-verification.js';
import { testEnv } from '../test/auth-helpers.js';

/**
 * Unit-tests voor de e-mailverificatie-kern (T1.4): token-generatie/hashing, aanmaken (met het
 * ongeldig maken van een vorig token) en inwisselen (eenmalig, verlopend, neutraal bij fout).
 */
describe('email-verification module', () => {
  beforeEach(async () => {
    await resetAuthData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('slaat het token alleen gehasht op en verifieert het account bij inwisselen', async () => {
    const { accountId } = await seedAccount('verify@intento.local', 'pw', 'ADMIN', undefined, {
      emailVerified: false,
    });

    const token = await createEmailVerificationToken(prisma, accountId, 24);

    // Db bevat de hash, niet het rauwe token.
    const row = await prisma.emailVerificationToken.findFirst({ where: { accountId } });
    expect(row?.tokenHash).toBe(hashVerificationToken(token));
    expect(row?.tokenHash).not.toBe(token);

    const result = await verifyEmailToken(prisma, token);
    expect(result.ok).toBe(true);

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    expect(account?.emailVerifiedAt).not.toBeNull();
  });

  it('weigert een reeds gebruikt token (eenmalig)', async () => {
    const { accountId } = await seedAccount('once@intento.local', 'pw', 'ADMIN', undefined, {
      emailVerified: false,
    });
    const token = await createEmailVerificationToken(prisma, accountId, 24);

    expect((await verifyEmailToken(prisma, token)).ok).toBe(true);
    const second = await verifyEmailToken(prisma, token);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('invalid_or_expired');
  });

  it('weigert een verlopen token', async () => {
    const { accountId } = await seedAccount('expired@intento.local', 'pw', 'ADMIN', undefined, {
      emailVerified: false,
    });
    // TTL van 0 uur → direct verlopen.
    const token = await createEmailVerificationToken(prisma, accountId, 0);
    // createEmailVerificationToken accepteert alleen positieve uren in de praktijk; forceer verval
    // door de vervaltijd in het verleden te zetten.
    await prisma.emailVerificationToken.updateMany({
      where: { accountId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await verifyEmailToken(prisma, token);
    expect(result.ok).toBe(false);

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    expect(account?.emailVerifiedAt).toBeNull();
  });

  it('weigert een onbekend token', async () => {
    const result = await verifyEmailToken(prisma, 'onbekend-token');
    expect(result.ok).toBe(false);
  });

  it('maakt een vorig ongebruikt token ongeldig bij het aanmaken van een nieuw (resend)', async () => {
    const { accountId } = await seedAccount('resend@intento.local', 'pw', 'ADMIN', undefined, {
      emailVerified: false,
    });

    const first = await createEmailVerificationToken(prisma, accountId, 24);
    const second = await createEmailVerificationToken(prisma, accountId, 24);

    // Slechts één actief token; het eerste werkt niet meer, het tweede wel.
    expect(await prisma.emailVerificationToken.count({ where: { accountId } })).toBe(1);
    expect((await verifyEmailToken(prisma, first)).ok).toBe(false);
    expect((await verifyEmailToken(prisma, second)).ok).toBe(true);
  });

  it('bouwt een verificatie-URL met het token als query-parameter', () => {
    const env = testEnv({ EMAIL_VERIFICATION_URL_BASE: 'https://app.intento.test/verify-email' });
    const url = buildVerificationUrl(env, 'abc123');
    expect(url).toBe('https://app.intento.test/verify-email?token=abc123');
  });
});
