import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SPEECH_MAX_TEXT_LENGTH } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createSpeechService, type SpeechSynthesizer } from '../speech/index.js';
import {
  deviceCookie,
  linkCaregiver,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Spraakuitvoer (T18.1/T18.2, DESIGN §5.3, §8.1, §9.4).
 *
 * De tests draaien met een **nagebootste synthesizer**: de echte spraakdienst (Piper) hoort niet in
 * een unittest thuis, en zo is precies te controleren wat de backend hem vraagt — vooral welke stem,
 * want die mag nooit van de client komen maar altijd uit het profiel van de gebruiker.
 */
describe('spraakuitvoer — /device/speech en /admin/users/:id/speech-preview', () => {
  let app: FastifyInstance;
  let calls: { text: string; voice: string }[];

  /** Synthesizer die niets synthetiseert maar onthoudt wat hem gevraagd is. */
  function fakeSynthesizer(): SpeechSynthesizer {
    return {
      synthesize(text: string, voice: string) {
        calls.push({ text, voice });
        return Promise.resolve({ audio: Buffer.from('RIFF-nep-audio'), contentType: 'audio/wav' });
      },
    };
  }

  async function buildWithSpeech(
    overrides: Record<string, string> = {},
    synthesizer: SpeechSynthesizer = fakeSynthesizer(),
  ): Promise<FastifyInstance> {
    const env = testEnv({ LOGIN_RATE_LIMIT_MAX: '100', ...overrides });
    return buildApp({ env, speech: createSpeechService(env, synthesizer) });
  }

  /** Zet spraak aan voor een gebruiker, eventueel met een andere stem. */
  async function enableSpeech(userId: string, voice = 'nl_NL-pim-medium'): Promise<void> {
    await prisma.userCommunicationProfile.update({
      where: { userId },
      data: { speechEnabled: true, speechVoice: voice },
    });
  }

  beforeEach(async () => {
    await resetAuthData();
    calls = [];
    app = await buildWithSpeech();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('spreekt de tekst uit met de stem uit het profiel van de gebruiker', async () => {
    const user = await seedUser('Sanne');
    await enableSpeech(user.id, 'nl_BE-nathalie-medium');
    const cookie = await deviceCookie(app, user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/device/speech',
      headers: { cookie },
      payload: { text: 'Ik wil graag water drinken.' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/wav');
    // De zin van een gebruiker hoort niet in een tussenliggende cache te blijven hangen.
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.rawPayload.length).toBeGreaterThan(0);
    // De stem komt uit het profiel, niet uit het verzoek: de tablet kan hem niet kiezen.
    expect(calls).toEqual([
      { text: 'Ik wil graag water drinken.', voice: 'nl_BE-nathalie-medium' },
    ]);
  });

  it('weigert zonder apparaatsessie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/device/speech',
      payload: { text: 'Hallo' },
    });
    expect(res.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('weigert als spraak uitstaat voor deze gebruiker', async () => {
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/device/speech',
      headers: { cookie },
      payload: { text: 'Hallo' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('SPEECH_DISABLED');
    expect(calls).toHaveLength(0);
  });

  it('weigert lege en te lange tekst op de grens', async () => {
    const user = await seedUser('Sanne');
    await enableSpeech(user.id);
    const cookie = await deviceCookie(app, user.id);

    for (const text of ['', '   ', 'a'.repeat(SPEECH_MAX_TEXT_LENGTH + 1)]) {
      const res = await app.inject({
        method: 'POST',
        url: '/device/speech',
        headers: { cookie },
        payload: { text },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it('synthetiseert dezelfde zin maar één keer (cache)', async () => {
    const user = await seedUser('Sanne');
    await enableSpeech(user.id);
    const cookie = await deviceCookie(app, user.id);

    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/device/speech',
        headers: { cookie },
        payload: { text: 'Waar heb je pijn?' },
      });
      expect(res.statusCode).toBe(200);
    }

    expect(calls).toHaveLength(1);
  });

  it('cachet per stem: dezelfde zin met een andere stem wordt opnieuw gesynthetiseerd', async () => {
    const user = await seedUser('Sanne');
    await enableSpeech(user.id, 'nl_NL-pim-medium');
    const cookie = await deviceCookie(app, user.id);

    const zeg = () =>
      app.inject({
        method: 'POST',
        url: '/device/speech',
        headers: { cookie },
        payload: { text: 'Waar heb je pijn?' },
      });

    expect((await zeg()).statusCode).toBe(200);
    await enableSpeech(user.id, 'nl_NL-alex-medium');
    expect((await zeg()).statusCode).toBe(200);

    expect(calls.map((call) => call.voice)).toEqual(['nl_NL-pim-medium', 'nl_NL-alex-medium']);
  });

  it('laat de apparaatstem niet door de server synthetiseren', async () => {
    const user = await seedUser('Sanne');
    await enableSpeech(user.id, 'device');
    const cookie = await deviceCookie(app, user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/device/speech',
      headers: { cookie },
      payload: { text: 'Hallo' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('SPEECH_VOICE_ON_DEVICE');
    expect(calls).toHaveLength(0);
  });

  it('meldt netjes dat er geen spraakdienst is als die niet geconfigureerd is', async () => {
    await app.close();
    // Zonder injectie bouwt de app zijn eigen dienst uit de env; SPEECH_PROVIDER staat standaard op none.
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
    const user = await seedUser('Sanne');
    await enableSpeech(user.id);
    const cookie = await deviceCookie(app, user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/device/speech',
      headers: { cookie },
      payload: { text: 'Hallo' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SPEECH_UNAVAILABLE');
  });

  describe('voorbeeld beluisteren door een begeleider', () => {
    it('laat een gekoppelde begeleider een stem beluisteren zonder de instelling op te slaan', async () => {
      const org = await seedOrganization('Org');
      const caregiver = await seedAccount('zorg@intento.local', 'pw', 'CAREGIVER', org);
      const user = await seedUser('Sanne', org);
      await linkCaregiver(caregiver.accountId, user.id);
      const cookie = await loginCookie(app, caregiver.email, caregiver.password);

      const res = await app.inject({
        method: 'POST',
        url: `/admin/users/${user.id}/speech-preview`,
        headers: { cookie },
        payload: { text: 'Ik wil graag water drinken.', voice: 'nl_BE-nathalie-medium' },
      });

      expect(res.statusCode).toBe(200);
      expect(calls).toEqual([
        { text: 'Ik wil graag water drinken.', voice: 'nl_BE-nathalie-medium' },
      ]);

      // Het profiel is niet aangeraakt: beluisteren is geen kiezen.
      const profile = await prisma.userCommunicationProfile.findUnique({
        where: { userId: user.id },
      });
      expect(profile?.speechEnabled).toBe(false);
      expect(profile?.speechVoice).toBe('nl_NL-pim-medium');
    });

    it('weigert een begeleider die niet aan deze gebruiker gekoppeld is', async () => {
      const org = await seedOrganization('Org');
      const caregiver = await seedAccount('zorg@intento.local', 'pw', 'CAREGIVER', org);
      const user = await seedUser('Sanne', org);
      const cookie = await loginCookie(app, caregiver.email, caregiver.password);

      const res = await app.inject({
        method: 'POST',
        url: `/admin/users/${user.id}/speech-preview`,
        headers: { cookie },
        payload: { text: 'Hallo', voice: 'nl_NL-pim-medium' },
      });

      expect(res.statusCode).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it('weigert een gebruiker uit een andere organisatie', async () => {
      const orgA = await seedOrganization('A');
      const orgB = await seedOrganization('B');
      const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN', orgA);
      const vreemde = await seedUser('Iemand anders', orgB);
      const cookie = await loginCookie(app, admin.email, admin.password);

      const res = await app.inject({
        method: 'POST',
        url: `/admin/users/${vreemde.id}/speech-preview`,
        headers: { cookie },
        payload: { text: 'Hallo', voice: 'nl_NL-pim-medium' },
      });

      expect(res.statusCode).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it('weigert een stem die niet in de catalogus staat', async () => {
      const org = await seedOrganization('Org');
      const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN', org);
      const user = await seedUser('Sanne', org);
      const cookie = await loginCookie(app, admin.email, admin.password);

      const res = await app.inject({
        method: 'POST',
        url: `/admin/users/${user.id}/speech-preview`,
        headers: { cookie },
        // Onverstaanbaar bevonden op 2026-08-28 en daarom uit de catalogus gehouden.
        payload: { text: 'Hallo', voice: 'nl_NL-mls-medium#5' },
      });

      expect(res.statusCode).toBe(400);
      expect(calls).toHaveLength(0);
    });
  });
});
