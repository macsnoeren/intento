import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '../errors.js';
import { testEnv } from '../test/auth-helpers.js';
import {
  assertSafeImageUrl,
  createOpenSymbolsClient,
  mapOpenSymbolsResults,
} from './opensymbols.js';

/**
 * Tests voor de OpenSymbols-client (verhuisd uit de oude AAC-bibliotheek in N0.4; hergebruikt voor de
 * import in N8.4/N8.5). De HTTP-tests praten met een lokale nep-server, nooit met het echte OpenSymbols.
 */

describe('OpenSymbols-hulpfuncties', () => {
  it('laat alleen https-afbeeldings-URL’s door de sanering (mapOpenSymbolsResults)', () => {
    const results = mapOpenSymbolsResults([
      { id: 1, name: 'ok', image_url: 'https://cdn.example.org/a.png', license: 'CC0' },
      { id: 2, name: 'onveilig-http', image_url: 'http://cdn.example.org/b.png', license: 'CC0' },
      { id: 3, name: 'geen-url', license: 'CC0' },
    ]);
    expect(results.map((r) => r.name)).toEqual(['ok']);
    expect(results[0]!.imageUrl.startsWith('https://')).toBe(true);
  });

  it('accepteert null-attributie uit de externe API (OpenSymbols stuurt null i.p.v. weglaten)', () => {
    const results = mapOpenSymbolsResults([
      {
        id: 7,
        symbol_key: null,
        name: 'drinken',
        image_url: 'https://cdn.example.org/drinken.svg',
        extension: 'svg',
        license: 'CC BY-SA',
        license_url: null,
        author: null,
        author_url: null,
        source_url: null,
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: '7',
      name: 'drinken',
      imageUrl: 'https://cdn.example.org/drinken.svg',
      license: 'CC BY-SA',
      licenseUrl: null,
      author: null,
      authorUrl: null,
      sourceUrl: null,
    });
  });

  it('houdt http-attributie maar gooit een javascript:-URL weg (mapOpenSymbolsResults)', () => {
    const results = mapOpenSymbolsResults([
      {
        id: 9,
        name: 'hond',
        image_url: 'https://cdn.example.org/os-9.png',
        license: 'CC BY-SA',
        license_url: 'http://creativecommons.org/licenses/by-sa/3.0/',
        author_url: 'javascript:alert(1)',
        source_url: 'http://www.opensymbols.org/symbols/os-9',
      },
    ]);
    expect(results[0]).toMatchObject({
      licenseUrl: 'http://creativecommons.org/licenses/by-sa/3.0/',
      authorUrl: null,
      sourceUrl: 'http://www.opensymbols.org/symbols/os-9',
    });
  });

  it('assertSafeImageUrl weigert niet-https en interne hosts', () => {
    expect(() => assertSafeImageUrl('http://example.org/a.png')).toThrow(HttpError);
    expect(() => assertSafeImageUrl('https://localhost/a.png')).toThrow(HttpError);
    expect(() => assertSafeImageUrl('https://10.0.0.5/a.png')).toThrow(HttpError);
    expect(() => assertSafeImageUrl('https://[::1]/a.png')).toThrow(HttpError);
    expect(assertSafeImageUrl('https://cdn.example.org/a.png').hostname).toBe('cdn.example.org');
  });
});

describe('OpenSymbols-client over HTTP', () => {
  let server: Server | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  /** Start een nep-OpenSymbols op een vrije poort; `handler` beantwoordt elke aanvraag. */
  async function fakeOpenSymbols(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Promise<string> {
    server = createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  function json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  it('is niet geconfigureerd zonder secret', () => {
    expect(createOpenSymbolsClient(testEnv()).isConfigured()).toBe(false);
    expect(createOpenSymbolsClient(testEnv({ OPENSYMBOLS_SECRET: 's' })).isConfigured()).toBe(true);
  });

  it('haalt eerst een token op en zoekt daarna; resultaten zijn gesaneerd', async () => {
    const seen: string[] = [];
    const url = await fakeOpenSymbols((req, res) => {
      seen.push(`${req.method} ${req.url?.split('?')[0]}`);
      if (req.url?.startsWith('/api/v2/token')) return json(res, 200, { access_token: 'tok-1' });
      expect(req.url).toContain('access_token=tok-1');
      expect(req.url).toContain('q=hond');
      return json(res, 200, [
        { id: 1, name: 'hond', image_url: 'https://cdn.example.org/hond.png', license: 'CC0' },
        { id: 2, name: 'kat', image_url: 'http://cdn.example.org/kat.png', license: 'CC0' },
      ]);
    });
    const client = createOpenSymbolsClient(
      testEnv({ OPENSYMBOLS_API_URL: url, OPENSYMBOLS_SECRET: 'geheim' }),
    );

    const results = await client.search('hond');

    expect(results.map((r) => r.name)).toEqual(['hond']);
    expect(seen).toEqual(['POST /api/v2/token', 'GET /api/v2/symbols']);
  });

  it('vernieuwt een verlopen token één keer bij een 401', async () => {
    let tokens = 0;
    const url = await fakeOpenSymbols((req, res) => {
      if (req.url?.startsWith('/api/v2/token')) {
        tokens += 1;
        return json(res, 200, { access_token: `tok-${tokens}` });
      }
      if (req.url?.includes('access_token=tok-1')) return json(res, 401, {});
      return json(res, 200, []);
    });
    const client = createOpenSymbolsClient(
      testEnv({ OPENSYMBOLS_API_URL: url, OPENSYMBOLS_SECRET: 'geheim' }),
    );

    await expect(client.search('hond')).resolves.toEqual([]);
    expect(tokens).toBe(2);
  });

  it('gooit bij een fout van de zoekdienst', async () => {
    const url = await fakeOpenSymbols((req, res) => {
      if (req.url?.startsWith('/api/v2/token')) return json(res, 200, { access_token: 't' });
      return json(res, 500, {});
    });
    const client = createOpenSymbolsClient(
      testEnv({ OPENSYMBOLS_API_URL: url, OPENSYMBOLS_SECRET: 'geheim' }),
    );
    await expect(client.search('hond')).rejects.toThrow(/status 500/);
  });

  it('weigert een afbeelding van een niet-https of interne bron vóór er iets gedownload wordt', async () => {
    const client = createOpenSymbolsClient(testEnv({ OPENSYMBOLS_SECRET: 'geheim' }));
    await expect(client.fetchImage('http://cdn.example.org/a.png')).rejects.toThrow(HttpError);
    await expect(client.fetchImage('https://127.0.0.1/a.png')).rejects.toThrow(HttpError);
  });
});
