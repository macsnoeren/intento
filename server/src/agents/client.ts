import {
  experienceRequestSchema,
  experienceResponseSchema,
  turnRequestSchema,
  turnResponseSchema,
  type ExperienceRequest,
  type ExperienceResponse,
  type TurnRequest,
  type TurnResponse,
} from '@intento/shared';
import type { ZodType } from 'zod';
import type { Env } from '../env.js';
import { HttpError } from '../errors.js';

/**
 * Client voor de agentdienst (INTENTO-NEW-DESIGN §3.1, §51, ADR-0017).
 *
 * De backend is de enige die de agentdienst aanroept: `POST {url}/v1/turn` (een beurt) en, na afloop van
 * een gesprek, `POST {url}/v1/experience` (observaties, N12.4), met het gedeelde geheim als Bearer en een
 * harde time-out. Het antwoord gaat door het zod-contract voordat iemand het gebruikt; de
 * inhoudelijke toets (de harde invarianten, §52) doet de aanroeper daarna.
 *
 * Elke fout — niet geconfigureerd, onbereikbaar, time-out, 401, 4xx/5xx, ongeldige vorm — wordt één
 * `AgentUnavailableError` (503 `AGENT_UNAVAILABLE`). De tablet kan er niets mee behalve "Even geen hulp"
 * tonen; de `reason` is voor het log en de `AgentDecision`, nooit voor de client.
 */

export type AgentFailureReason =
  | 'not_configured'
  | 'unreachable'
  | 'timeout'
  | 'unauthorized'
  | 'rejected'
  | 'server_error'
  | 'too_large'
  | 'invalid_response'
  | 'invariant_violation';

export class AgentUnavailableError extends HttpError {
  constructor(
    readonly reason: AgentFailureReason,
    readonly detail: string,
  ) {
    super(503, 'AGENT_UNAVAILABLE', 'De hulp is even niet beschikbaar. Probeer het zo opnieuw.');
    this.name = 'AgentUnavailableError';
  }
}

export interface AgentClient {
  turn(request: TurnRequest): Promise<TurnResponse>;
  /** Observaties over een afgerond gesprek (§21 laag 2). Niemand wacht hierop. */
  experience(request: ExperienceRequest): Promise<ExperienceResponse>;
}

/** Bovengrens voor een antwoord: ruim boven een normale beurt, maar geen onbegrensd geheugengebruik. */
export const AGENT_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

/** Er is geen agentdienst geconfigureerd (`AGENT_SERVICE_URL` leeg). */
class UnconfiguredAgentClient implements AgentClient {
  turn(): Promise<TurnResponse> {
    return Promise.reject(
      new AgentUnavailableError('not_configured', 'AGENT_SERVICE_URL is niet gezet.'),
    );
  }

  experience(): Promise<ExperienceResponse> {
    return Promise.reject(
      new AgentUnavailableError('not_configured', 'AGENT_SERVICE_URL is niet gezet.'),
    );
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new AgentUnavailableError('too_large', `Antwoord van ${declared} bytes.`);
  }
  if (!response.body) return '';
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AgentUnavailableError('too_large', `Antwoord groter dan ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class HttpAgentClient implements AgentClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs: number,
    private readonly maxResponseBytes: number = AGENT_RESPONSE_MAX_BYTES,
  ) {}

  async turn(request: TurnRequest): Promise<TurnResponse> {
    // Ook wat wij versturen houden we aan het contract: een fout hier is een bug in de backend.
    const response = await this.post(
      '/v1/turn',
      turnRequestSchema.parse(request),
      turnResponseSchema,
    );
    if (
      response.session_id !== request.session_id ||
      response.turn !== request.turn ||
      response.state.session_id !== request.session_id ||
      response.state.turn !== request.turn
    ) {
      throw new AgentUnavailableError(
        'invalid_response',
        'Antwoord hoort bij een ander gesprek of een andere beurt.',
      );
    }
    return response;
  }

  async experience(request: ExperienceRequest): Promise<ExperienceResponse> {
    const response = await this.post(
      '/v1/experience',
      experienceRequestSchema.parse(request),
      experienceResponseSchema,
    );
    if (response.session_id !== request.session_id) {
      throw new AgentUnavailableError('invalid_response', 'Antwoord hoort bij een ander gesprek.');
    }
    return response;
  }

  /** Eén aanroep: versturen, begrensd lezen en het antwoord door het contract halen. */
  private async post<T>(path: string, request: unknown, schema: ZodType<T>): Promise<T> {
    const body = JSON.stringify(request);
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body,
        signal,
      });
      text = await readLimited(response, this.maxResponseBytes);
    } catch (error) {
      if (error instanceof AgentUnavailableError) throw error;
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new AgentUnavailableError('timeout', `Geen antwoord binnen ${this.timeoutMs} ms.`);
      }
      throw new AgentUnavailableError(
        'unreachable',
        error instanceof Error ? error.message : 'onbekende fout',
      );
    }

    if (response.status === 401) {
      throw new AgentUnavailableError('unauthorized', 'De agentdienst weigerde de API-key.');
    }
    if (!response.ok) {
      throw new AgentUnavailableError(
        response.status >= 500 ? 'server_error' : 'rejected',
        `Status ${response.status}: ${errorCode(text)}`,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AgentUnavailableError('invalid_response', 'Geen geldige JSON.');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // Alleen de veldpaden: de waarden kunnen gespreksinhoud bevatten.
      const paths = parsed.error.issues
        .slice(0, 5)
        .map((issue) => issue.path.join('.') || '(root)')
        .join(', ');
      throw new AgentUnavailableError('invalid_response', `Contract geschonden bij: ${paths}`);
    }
    return parsed.data;
  }
}

/** De foutcode uit `{ error: { code } }`, zonder de rest van de body te loggen. */
function errorCode(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'object' && value !== null && 'error' in value) {
      const error: unknown = value.error;
      if (typeof error === 'object' && error !== null && 'code' in error) {
        return typeof error.code === 'string' ? error.code : 'onbekend';
      }
    }
  } catch {
    // geen JSON
  }
  return 'onbekend';
}

/** Bouwt de client die bij de omgeving hoort. */
export function createAgentClient(env: Env): AgentClient {
  if (!env.AGENT_SERVICE_URL) return new UnconfiguredAgentClient();
  return new HttpAgentClient(
    env.AGENT_SERVICE_URL.replace(/\/+$/, ''),
    env.AGENT_SERVICE_TOKEN,
    env.AGENT_TIMEOUT_MS,
  );
}

/**
 * Nep-agentdienst voor tests: antwoordt met wat de meegegeven functie teruggeeft (of gooit wat die
 * gooit) en onthoudt elke aanvraag, zodat tests kunnen controleren wat de backend verstuurde. Het
 * antwoord gaat net als bij de echte client door het zod-contract.
 */
export class FakeAgentClient implements AgentClient {
  readonly requests: TurnRequest[] = [];
  readonly experienceRequests: ExperienceRequest[] = [];
  /** Wat `experience` antwoordt; standaard één observatie. Vervangbaar in een test. */
  observe: (request: ExperienceRequest) => ExperienceResponse | Promise<ExperienceResponse> = (
    request,
  ) => ({
    contract_version: 1,
    session_id: request.session_id,
    notes: [{ about: 'flow', text: 'Een observatie van de nep-agentdienst.', confidence: 0.5 }],
    decision: {
      agent: 'experience-agent',
      status: 'success',
      model: null,
      prompt_version: 'rules-v1',
      latency_ms: 1,
      validation: 'skipped',
      reason: null,
    },
  });

  constructor(private respond: (request: TurnRequest) => TurnResponse | Promise<TurnResponse>) {}

  /** Vervangt het gedrag halverwege een test. */
  setResponder(respond: (request: TurnRequest) => TurnResponse | Promise<TurnResponse>): void {
    this.respond = respond;
  }

  async turn(request: TurnRequest): Promise<TurnResponse> {
    this.requests.push(turnRequestSchema.parse(request));
    const response = await this.respond(request);
    const parsed = turnResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new AgentUnavailableError('invalid_response', parsed.error.message);
    }
    return parsed.data;
  }

  async experience(request: ExperienceRequest): Promise<ExperienceResponse> {
    this.experienceRequests.push(experienceRequestSchema.parse(request));
    const parsed = experienceResponseSchema.safeParse(await this.observe(request));
    if (!parsed.success) {
      throw new AgentUnavailableError('invalid_response', parsed.error.message);
    }
    return parsed.data;
  }
}
