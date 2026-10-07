import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { contactListResponseSchema, contactPublicSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { MemoryMailTransport } from '../mail/transport.js';

/** Opt-in van een contact (N10.2, INTENTO-NEW-DESIGN §28, V5). */

const PASSWORD = 'correct horse battery staple';

/** Het token uit de laatst verstuurde bevestigingsmail. */
function tokenFrom(mail: MemoryMailTransport): string {
  const match = /contact-bevestigen\?token=([\w-]+)/.exec(mail.last()?.text ?? '');
  if (!match?.[1]) throw new Error('geen bevestigingslink in de mail');
  return match[1];
}

describe('opt-in van een contact', () => {
  let app: FastifyInstance;
  let mail: MemoryMailTransport;
  let cookie: string;
  let userId: string;

  beforeEach(async () => {
    await resetAuthData();
    mail = new MemoryMailTransport();
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '1000', RESEND_RATE_LIMIT_MAX: '100' }),
      mail,
    });
    const org = await prisma.organization.create({
      data: { name: 'Familie Jansen', type: 'family' },
    });
    await seedAccount('admin@intento.local', PASSWORD, 'ADMIN', org.id);
    cookie = await loginCookie(app, 'admin@intento.local', PASSWORD);
    userId = (await seedUser('Sanne', org.id)).id;
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
  });

  async function addMama(email = 'mama@example.org') {
    const res = await app.inject({
      method: 'POST',
      url: `/users/${userId}/contacts`,
      headers: { cookie },
      payload: { name: 'Mama', relation: 'moeder', email },
    });
    expect(res.statusCode).toBe(201);
    return contactPublicSchema.parse(res.json());
  }

  function confirm(token: string) {
    return app.inject({ method: 'POST', url: '/contacts/verify', payload: { token } });
  }

  function check(token: string) {
    return app.inject({ method: 'GET', url: `/contacts/verify?token=${token}` });
  }

  async function verified(id: string): Promise<boolean> {
    const res = await app.inject({
      method: 'GET',
      url: `/users/${userId}/contacts`,
      headers: { cookie },
    });
    return (
      contactListResponseSchema.parse(res.json()).contacts.find((c) => c.id === id)
        ?.emailVerified ?? false
    );
  }

  it('stuurt bij aanmaken een mail; pas na de klik op "Ja" is het contact bevestigd', async () => {
    const mama = await addMama();
    expect(mail.sent).toHaveLength(1);
    const message = mail.last();
    expect(message?.to).toBe('mama@example.org');
    expect(message?.text).toContain('Hallo Mama');
    expect(message?.text).toContain('Familie Jansen');
    expect(message?.text).not.toContain('Sanne'); // de gebruiker staat er niet in
    const token = tokenFrom(mail);

    // Alleen de hash staat in de db.
    const rows = await prisma.contactVerificationToken.findMany();
    expect(JSON.stringify(rows)).not.toContain(token);

    // Een GET (zoals een mailscanner doet) verandert niets.
    expect((await check(token)).json()).toEqual({ valid: true });
    expect(await verified(mama.id)).toBe(false);

    const res = await confirm(token);
    expect(res.statusCode).toBe(200);
    expect(await verified(mama.id)).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'contact.verify' } });
    expect(audit).toMatchObject({ targetId: mama.id, accountId: null });
    expect(audit.organizationId).not.toBeNull();
  });

  it('een gebruikte link werkt niet nog eens', async () => {
    await addMama();
    const token = tokenFrom(mail);
    expect((await confirm(token)).statusCode).toBe(200);
    const again = await confirm(token);
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({ error: { code: 'INVALID_OR_EXPIRED' } });
    expect((await check(token)).json()).toEqual({ valid: false });
  });

  it('een verlopen link werkt niet', async () => {
    const mama = await addMama();
    const token = tokenFrom(mail);
    await prisma.contactVerificationToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await confirm(token)).statusCode).toBe(400);
    expect(await verified(mama.id)).toBe(false);
  });

  it('een onbekend of misvormd token: dezelfde neutrale fout', async () => {
    expect((await confirm('x'.repeat(43))).statusCode).toBe(400);
    expect((await confirm('kort')).statusCode).toBe(400);
    expect((await check('kort')).json()).toEqual({ valid: false });
  });

  it('een nieuw adres zet de bevestiging terug; de oude link vervalt; een nieuwe mail gaat eruit', async () => {
    const mama = await addMama();
    const old = tokenFrom(mail);
    expect((await confirm(old)).statusCode).toBe(200);

    const res = await app.inject({
      method: 'PATCH',
      url: `/users/${userId}/contacts/${mama.id}`,
      headers: { cookie },
      payload: { email: 'mama@elders.org' },
    });
    expect(res.json()).toMatchObject({ emailVerified: false });
    expect(mail.sent).toHaveLength(2);
    expect(mail.last()?.to).toBe('mama@elders.org');
    const fresh = tokenFrom(mail);
    expect(fresh).not.toBe(old);
    expect((await confirm(fresh)).statusCode).toBe(200);
    expect(await verified(mama.id)).toBe(true);
  });

  it('een nieuw adres vóór de bevestiging: de link naar het oude adres werkt niet meer', async () => {
    const mama = await addMama();
    const old = tokenFrom(mail);
    await app.inject({
      method: 'PATCH',
      url: `/users/${userId}/contacts/${mama.id}`,
      headers: { cookie },
      payload: { email: 'mama@elders.org' },
    });
    expect((await confirm(old)).statusCode).toBe(400);
    expect(await verified(mama.id)).toBe(false);
  });

  it('opnieuw versturen: nieuwe link, de vorige vervalt; niet als het al bevestigd is', async () => {
    const mama = await addMama();
    const first = tokenFrom(mail);
    const resend = () =>
      app.inject({
        method: 'POST',
        url: `/users/${userId}/contacts/${mama.id}/verification`,
        headers: { cookie },
      });
    expect((await resend()).statusCode).toBe(204);
    const second = tokenFrom(mail);
    expect(second).not.toBe(first);
    expect((await confirm(first)).statusCode).toBe(400);
    expect((await confirm(second)).statusCode).toBe(200);
    const done = await resend();
    expect(done.statusCode).toBe(409);
    expect(done.json()).toMatchObject({ error: { code: 'ALREADY_VERIFIED' } });
  });

  it('een mislukte mail breekt het aanmaken niet; opnieuw versturen meldt het wel', async () => {
    await app.close();
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '1000', RESEND_RATE_LIMIT_MAX: '100' }),
      mail: { send: () => Promise.reject(new Error('mailserver weg')) },
    });
    cookie = await loginCookie(app, 'admin@intento.local', PASSWORD);
    const mama = await addMama();
    expect(mama.emailVerified).toBe(false);
    const resend = await app.inject({
      method: 'POST',
      url: `/users/${userId}/contacts/${mama.id}/verification`,
      headers: { cookie },
    });
    expect(resend.statusCode).toBe(502);
  });

  it('opnieuw versturen kan niet voor een contact van een andere organisatie', async () => {
    const mama = await addMama();
    const other = await seedOrganization('Ander');
    await seedAccount('b@intento.local', PASSWORD, 'ADMIN', other);
    const otherCookie = await loginCookie(app, 'b@intento.local', PASSWORD);
    const res = await app.inject({
      method: 'POST',
      url: `/users/${userId}/contacts/${mama.id}/verification`,
      headers: { cookie: otherCookie },
    });
    expect(res.statusCode).toBe(403);
    expect(mail.sent).toHaveLength(1);
  });
});
