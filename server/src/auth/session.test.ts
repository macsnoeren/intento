import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { resetAuthData, seedAccount } from '../test/auth-helpers.js';
import {
  createSession,
  deleteSessionByToken,
  findAccountBySessionToken,
  hashSessionToken,
} from './session.js';

describe('sessiebeheer', () => {
  beforeEach(resetAuthData);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('bewaart alleen de hash, nooit het rauwe token', async () => {
    const { accountId } = await seedAccount();
    const { token } = await createSession(prisma, accountId, 1);

    const stored = await prisma.session.findFirst();
    expect(stored?.tokenHash).toBe(hashSessionToken(token));
    expect(stored?.tokenHash).not.toBe(token); // hash ≠ rauw token
    // Het rauwe token komt nergens plaintext in de rij voor.
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('vindt het account terug bij een geldig token', async () => {
    const { accountId } = await seedAccount();
    const { token } = await createSession(prisma, accountId, 1);

    const account = await findAccountBySessionToken(prisma, token);
    expect(account?.id).toBe(accountId);
  });

  it('weigert een onbekend token', async () => {
    expect(await findAccountBySessionToken(prisma, 'onbekend')).toBeNull();
  });

  it('weigert en verwijdert een verlopen sessie', async () => {
    const { accountId } = await seedAccount();
    const { token } = await createSession(prisma, accountId, -1); // al verlopen

    expect(await findAccountBySessionToken(prisma, token)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it('verwijdert een sessie bij logout', async () => {
    const { accountId } = await seedAccount();
    const { token } = await createSession(prisma, accountId, 1);

    await deleteSessionByToken(prisma, token);
    expect(await prisma.session.count()).toBe(0);
    expect(await findAccountBySessionToken(prisma, token)).toBeNull();
  });
});
