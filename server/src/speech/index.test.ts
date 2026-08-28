import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpeechService, HttpSpeechSynthesizer } from './index.js';
import { HttpError } from '../errors.js';
import { loadEnv } from '../env.js';

/**
 * De spraaklaag zelf (T18.1): de HTTP-client naar de spraakdienst en de cache ervoor.
 *
 * Deze tests bestaan vooral om **misleidende foutmeldingen** te voorkomen. Toen een stemmodel stuk
 * bleek (een afgebroken download), liet de dienst de verbinding vallen en meldde de backend "de
 * spraakdienst antwoordde niet op tijd" — waarna een beheerder ging zoeken naar een dienst die
 * gewoon draaide. Een fout moet zeggen wát er mis is.
 */
describe('spraaklaag — client en cache', () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    SIGNING_SECRET: 's',
    ENCRYPTION_KEY: 'e',
    SPEECH_CACHE_MAX_ENTRIES: '2',
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Vervangt `fetch` door een nepversie voor de duur van één test. */
  function stubFetch(impl: () => Promise<Response> | Promise<never>): void {
    vi.stubGlobal('fetch', vi.fn(impl));
  }

  const client = () => new HttpSpeechSynthesizer('http://spraak.test', 'token', 50);

  it('geeft de audio terug die de dienst levert', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/wav' } }),
      ),
    );

    const spoken = await client().synthesize('Hallo', 'nl_NL-pim-medium');
    expect(spoken.contentType).toBe('audio/wav');
    expect(spoken.audio).toHaveLength(3);
  });

  it('meldt een onbereikbare dienst als 502 mét reden — niet als time-out', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed: ECONNREFUSED')));

    await expect(client().synthesize('Hallo', 'nl_NL-pim-medium')).rejects.toMatchObject({
      statusCode: 502,
      code: 'SPEECH_FAILED',
      message: expect.stringContaining('ECONNREFUSED'),
    });
  });

  it('meldt een echte time-out wél als time-out', async () => {
    stubFetch(() => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    await expect(client().synthesize('Hallo', 'nl_NL-pim-medium')).rejects.toMatchObject({
      statusCode: 504,
      code: 'SPEECH_TIMEOUT',
    });
  });

  it('meldt een foutstatus van de dienst als 502', async () => {
    stubFetch(() => Promise.resolve(new Response('{}', { status: 500 })));

    await expect(client().synthesize('Hallo', 'nl_NL-pim-medium')).rejects.toBeInstanceOf(
      HttpError,
    );
  });

  it('weigert lege audio in plaats van stilte door te geven', async () => {
    stubFetch(() => Promise.resolve(new Response(new Uint8Array([]))));

    await expect(client().synthesize('Hallo', 'nl_NL-pim-medium')).rejects.toMatchObject({
      statusCode: 502,
    });
  });

  it('haalt dezelfde zin maar één keer op en verdringt de oudste bij een volle cache', async () => {
    let calls = 0;
    const service = createSpeechService(env, {
      synthesize: (text) => {
        calls += 1;
        return Promise.resolve({ audio: Buffer.from(text), contentType: 'audio/wav' });
      },
    });

    await service.speak('een', 'nl_NL-pim-medium');
    await service.speak('een', 'nl_NL-pim-medium');
    expect(calls).toBe(1);

    // Cache is op twee fragmenten gezet: de derde zin duwt de oudste eruit.
    await service.speak('twee', 'nl_NL-pim-medium');
    await service.speak('drie', 'nl_NL-pim-medium');
    expect(service.cacheSize).toBe(2);

    await service.speak('een', 'nl_NL-pim-medium');
    expect(calls).toBe(4);
  });

  it('laat de apparaatstem niet door de server synthetiseren', async () => {
    const service = createSpeechService(env, {
      synthesize: () => Promise.reject(new Error('had niet aangeroepen mogen worden')),
    });

    await expect(service.speak('Hallo', 'device')).rejects.toMatchObject({
      statusCode: 400,
      code: 'SPEECH_VOICE_ON_DEVICE',
    });
  });

  it('geeft zonder geconfigureerde dienst een begrijpelijke 503', async () => {
    const service = createSpeechService(env);
    await expect(service.speak('Hallo', 'nl_NL-pim-medium')).rejects.toMatchObject({
      statusCode: 503,
      code: 'SPEECH_UNAVAILABLE',
    });
  });
});
