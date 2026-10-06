import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { TurnRequest, TurnResponse } from '@intento/shared';
import { testEnv } from '../test/auth-helpers.js';
import {
  AgentUnavailableError,
  FakeAgentClient,
  HttpAgentClient,
  createAgentClient,
} from './client.js';

/** Client voor de agentdienst (N4.3, INTENTO-NEW-DESIGN §3.1, §51), tegen een lokale nep-HTTP-server. */

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'contracts',
  'fixtures',
  'valid',
);
const request = JSON.parse(
  readFileSync(join(FIXTURES, 'turn_request.start.json'), 'utf8'),
) as TurnRequest;
const response = JSON.parse(
  readFileSync(join(FIXTURES, 'turn_response.question.json'), 'utf8'),
) as TurnResponse;

const TOKEN = 'agt_test_token_123456';

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

let server: Server | null = null;

async function startServer(handler: Handler): Promise<string> {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function failure(promise: Promise<unknown>): Promise<AgentUnavailableError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AgentUnavailableError) return error;
    throw error;
  }
  throw new Error('verwachtte een AgentUnavailableError');
}

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
});

describe('HttpAgentClient', () => {
  it('stuurt de beurt met API-key en geeft het gevalideerde antwoord terug', async () => {
    let seen: { path?: string; auth?: string; body?: unknown } = {};
    const url = await startServer((req, res, body) => {
      seen = { path: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      sendJson(res, 200, response);
    });
    const client = new HttpAgentClient(url, TOKEN, 2000);
    expect(await client.turn(request)).toEqual(response);
    expect(seen).toEqual({ path: '/v1/turn', auth: `Bearer ${TOKEN}`, body: request });
  });

  it('geeft een time-out als AgentUnavailableError', async () => {
    const url = await startServer(() => {
      // nooit antwoorden
    });
    const error = await failure(new HttpAgentClient(url, TOKEN, 100).turn(request));
    expect(error.reason).toBe('timeout');
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('AGENT_UNAVAILABLE');
  });

  it('weigert een antwoord dat het contract schendt', async () => {
    const url = await startServer((_req, res) => {
      sendJson(res, 200, { ...response, presentation: { kind: 'chat', text: 'hoi' } });
    });
    const error = await failure(new HttpAgentClient(url, TOKEN, 2000).turn(request));
    expect(error.reason).toBe('invalid_response');
    expect(error.detail).toContain('presentation');
    expect(error.detail).not.toContain('hoi');
  });

  it('weigert een antwoord voor een andere beurt', async () => {
    const url = await startServer((_req, res) => sendJson(res, 200, { ...response, turn: 7 }));
    const error = await failure(new HttpAgentClient(url, TOKEN, 2000).turn(request));
    expect(error.reason).toBe('invalid_response');
  });

  it('weigert geen-JSON', async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{kapot');
    });
    expect((await failure(new HttpAgentClient(url, TOKEN, 2000).turn(request))).reason).toBe(
      'invalid_response',
    );
  });

  it('meldt een 401 als unauthorized', async () => {
    const url = await startServer((_req, res) =>
      sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'nee' } }),
    );
    const error = await failure(
      new HttpAgentClient(url, 'verkeerde-key-12345', 2000).turn(request),
    );
    expect(error.reason).toBe('unauthorized');
    expect(error.statusCode).toBe(503);
  });

  it('meldt 4xx en 5xx met alleen de foutcode', async () => {
    let status = 409;
    const url = await startServer((_req, res) =>
      sendJson(res, status, { error: { code: 'PROTOCOL_ERROR', message: 'geheim' } }),
    );
    const client = new HttpAgentClient(url, TOKEN, 2000);
    const rejected = await failure(client.turn(request));
    expect(rejected.reason).toBe('rejected');
    expect(rejected.detail).toContain('PROTOCOL_ERROR');
    expect(rejected.detail).not.toContain('geheim');
    status = 500;
    expect((await failure(client.turn(request))).reason).toBe('server_error');
  });

  it('breekt een te groot antwoord af', async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('x'.repeat(5000));
    });
    const error = await failure(new HttpAgentClient(url, TOKEN, 2000, 1000).turn(request));
    expect(error.reason).toBe('too_large');
  });

  it('meldt een onbereikbare dienst', async () => {
    const url = await startServer(() => undefined);
    server?.close();
    server?.closeAllConnections();
    server = null;
    const error = await failure(new HttpAgentClient(url, TOKEN, 2000).turn(request));
    expect(['unreachable', 'timeout']).toContain(error.reason);
  });
});

describe('createAgentClient', () => {
  it('geeft zonder AGENT_SERVICE_URL altijd AGENT_UNAVAILABLE', async () => {
    const client = createAgentClient(testEnv({ AGENT_SERVICE_URL: '' }));
    expect((await failure(client.turn(request))).reason).toBe('not_configured');
  });
});

describe('FakeAgentClient', () => {
  it('onthoudt aanvragen en valideert het antwoord', async () => {
    const fake = new FakeAgentClient(() => response);
    expect(await fake.turn(request)).toEqual(response);
    expect(fake.requests).toHaveLength(1);

    fake.setResponder(
      () => ({ ...response, gaps: [{ type: 'onzin' }] }) as unknown as TurnResponse,
    );
    expect((await failure(fake.turn(request))).reason).toBe('invalid_response');
  });
});
