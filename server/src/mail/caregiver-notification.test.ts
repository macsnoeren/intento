import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { MemoryMailTransport, type MailTransport } from './transport.js';
import {
  deviceCookie,
  linkCaregiver,
  resetAuthData,
  seedAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Seintje aan de begeleider bij een bevestigde boodschap (T13.2, DESIGN §3.3, §3.6, §9.4).
 *
 * Drie dingen liggen hier vast, en ze zijn alle drie een bewuste keuze en geen implementatiedetail:
 * de mail gaat naar de **gekoppelde** begeleiders en naar niemand anders, de **boodschap zelf staat er
 * niet in** (e-mail is een extern kanaal), en een **mailfout maakt het bevestigen nooit stuk** — de
 * gebruiker heeft dan al gezegd wat hij wilde zeggen.
 */
describe('melding aan de begeleider bij een bevestigde boodschap (T13.2)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  /** Bouwt de app met het meegegeven mail-transport en de gevraagde env-overrides. */
  async function buildWith(
    mail: MailTransport,
    overrides: Record<string, string> = {},
  ): Promise<void> {
    app = await buildApp({
      env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100', ...overrides }),
      mail,
    });
  }

  /** Laat de gebruiker een boodschap samenstellen en bevestigen; geeft de bevestigde zin terug. */
  async function speak(userId: string): Promise<string> {
    const cookie = await deviceCookie(app, userId);
    const start = await app.inject({
      method: 'POST',
      url: '/conversation/start',
      headers: { cookie },
    });
    const sessionId = start.json().sessionId as string;
    const want = await prisma.aacSymbol.findUnique({ where: { concept: 'want' } });
    await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: want!.id },
    });
    const confirm = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/confirm`,
      headers: { cookie },
    });
    expect(confirm.statusCode).toBe(200);
    return confirm.json().message as string;
  }

  it('mailt de gekoppelde begeleider — met naam en tijd, zonder de boodschap zelf', async () => {
    const mail = new MemoryMailTransport();
    await buildWith(mail);
    const { organizationId } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    const begeleider = await seedAccount(
      'zorg@intento.local',
      'pw-begeleider-gekoppeld',
      'CAREGIVER',
      organizationId,
    );
    await linkCaregiver(begeleider.accountId, user.id);

    const gezegd = await speak(user.id);

    expect(mail.sent).toHaveLength(1);
    const bericht = mail.last()!;
    expect(bericht.to).toBe('zorg@intento.local');
    expect(bericht.subject).toContain('Sanne');
    // Genoeg om te weten dát je moet kijken…
    expect(bericht.text).toContain('Sanne');
    expect(bericht.text).toMatch(/\d{1,2}:\d{2}/);
    // …maar de zin van de gebruiker blijft achter authenticatie (§9.4).
    expect(bericht.text).not.toContain(gezegd);
    expect(bericht.html ?? '').not.toContain(gezegd);
  });

  it('mailt niet naar een begeleider die niet aan deze gebruiker gekoppeld is', async () => {
    const mail = new MemoryMailTransport();
    await buildWith(mail);
    const { organizationId } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    // Zelfde organisatie, geen koppeling: die zou anders mail krijgen over elke zin van iedereen.
    await seedAccount('ander@intento.local', 'pw-niet-gekoppeld-hier', 'CAREGIVER', organizationId);

    await speak(user.id);

    expect(mail.sent).toEqual([]);
  });

  it('stuurt elke gekoppelde begeleider een eigen mail', async () => {
    const mail = new MemoryMailTransport();
    await buildWith(mail);
    const { organizationId } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    const een = await seedAccount(
      'een@intento.local',
      'pw-begeleider-een-x',
      'CAREGIVER',
      organizationId,
    );
    const twee = await seedAccount(
      'twee@intento.local',
      'pw-begeleider-twee-x',
      'CAREGIVER',
      organizationId,
    );
    await linkCaregiver(een.accountId, user.id);
    await linkCaregiver(twee.accountId, user.id);

    await speak(user.id);

    expect(mail.sent.map((entry) => entry.to).sort()).toEqual([
      'een@intento.local',
      'twee@intento.local',
    ]);
  });

  it('laat het bevestigen doorgaan als de mailserver faalt', async () => {
    // De boodschap van de gebruiker mag nooit stukgaan op een mailserver: die heeft hij al gegeven.
    const kapot: MailTransport = {
      send: () => Promise.reject(new Error('smtp onbereikbaar')),
    };
    await buildWith(kapot);
    const { organizationId } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    const begeleider = await seedAccount(
      'zorg@intento.local',
      'pw-begeleider-gekoppeld',
      'CAREGIVER',
      organizationId,
    );
    await linkCaregiver(begeleider.accountId, user.id);

    const gezegd = await speak(user.id);

    // De boodschap staat gewoon vast en de sessie is netjes afgerond.
    const opgeslagen = await prisma.generatedMessage.findMany({ where: { confirmed: true } });
    expect(opgeslagen.map((entry) => entry.message)).toEqual([gezegd]);
  });

  it('stuurt niets met NOTIFY_CAREGIVERS_BY_EMAIL=false', async () => {
    const mail = new MemoryMailTransport();
    await buildWith(mail, { NOTIFY_CAREGIVERS_BY_EMAIL: 'false' });
    const { organizationId } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    const begeleider = await seedAccount(
      'zorg@intento.local',
      'pw-begeleider-gekoppeld',
      'CAREGIVER',
      organizationId,
    );
    await linkCaregiver(begeleider.accountId, user.id);

    await speak(user.id);

    expect(mail.sent).toEqual([]);
  });
});
