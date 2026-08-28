import { createHash } from 'node:crypto';
import { isDeviceVoice } from '@intento/shared';
import type { Env } from '../env.js';
import { HttpError } from '../errors.js';

/**
 * Spraakuitvoer (T18.1, DESIGN §5.3, §9.2, §9.4).
 *
 * De backend praat namens de tablet met een **losstaande spraakdienst** (`speech-service/`, Piper op
 * de CPU); de tablet nooit rechtstreeks — dezelfde regel als bij de AI (DESIGN §8.1). Dat is hier geen
 * formaliteit: de tekst die uitgesproken wordt is precies wat de gebruiker wil zeggen, dus wie hem mag
 * horen is een autorisatievraag en die hoort in de backend.
 *
 * De laag hieronder is bewust provider-agnostisch (zoals de AI-orchestrator, ADR-0008): een
 * `SpeechSynthesizer` zet tekst + stem om in audio, en wie dat doet — een HTTP-dienst, of niemand —
 * bepaalt de env.
 */

/** Eén gesynthetiseerd fragment. Blijft in het geheugen; het wordt nooit opgeslagen (DESIGN §6.4). */
export interface SpeechAudio {
  audio: Buffer;
  /** Altijd een concreet audioformaat, zodat de route het onveranderd kan doorgeven. */
  contentType: string;
}

/** Provider-agnostische synthese-interface. */
export interface SpeechSynthesizer {
  synthesize(text: string, voice: string): Promise<SpeechAudio>;
}

/** De spraakdienst zoals de routes hem gebruiken: synthese mét cache. */
export interface SpeechService {
  speak(text: string, voice: string): Promise<SpeechAudio>;
  /** Alleen voor tests/diagnose: hoeveel fragmenten staan er in de cache? */
  readonly cacheSize: number;
}

/** Er is geen spraakdienst geconfigureerd (`SPEECH_PROVIDER=none`). */
class UnavailableSynthesizer implements SpeechSynthesizer {
  synthesize(): Promise<SpeechAudio> {
    return Promise.reject(
      new HttpError(
        503,
        'SPEECH_UNAVAILABLE',
        'Er is geen spraakdienst beschikbaar. Zet SPEECH_PROVIDER=http en configureer SPEECH_SERVICE_URL.',
      ),
    );
  }
}

/**
 * De HTTP-client naar `speech-service/`. Stuurt `POST {url}/synthesize` met `{ text, voice }` en
 * verwacht audio terug. Het gedeelde geheim gaat als Bearer mee; een time-out voorkomt dat een
 * hangende dienst de tablet ophoudt.
 */
export class HttpSpeechSynthesizer implements SpeechSynthesizer {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs: number,
  ) {}

  async synthesize(text: string, voice: string): Promise<SpeechAudio> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'audio/wav',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ text, voice }),
        signal: controller.signal,
      });
      if (!response.ok) {
        // De dienst kent de stem niet (400) of ligt eruit (5xx). In beide gevallen kan de client er
        // niets mee; hij krijgt één begrijpelijke fout en de tablet valt terug op zijn eigen stem.
        throw new HttpError(
          502,
          'SPEECH_FAILED',
          `De spraakdienst antwoordde met status ${response.status}.`,
        );
      }
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.length === 0) {
        throw new HttpError(502, 'SPEECH_FAILED', 'De spraakdienst leverde geen audio.');
      }
      return {
        audio,
        contentType: response.headers.get('content-type') ?? 'audio/wav',
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Onderscheid de time-out van "de dienst deed iets anders raars". Alles op één hoop gooien
      // leverde een misleidende melding op: bij een kapot stemmodel viel de verbinding weg en las de
      // begeleider "de spraakdienst antwoordde niet op tijd", terwijl de dienst gewoon draaide.
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HttpError(504, 'SPEECH_TIMEOUT', 'De spraakdienst antwoordde niet op tijd.');
      }
      throw new HttpError(
        502,
        'SPEECH_FAILED',
        `De spraakdienst is niet bereikbaar of gaf een onverwacht antwoord (${
          error instanceof Error ? error.message : 'onbekende fout'
        }).`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Bouwt de synthesizer die bij de omgeving hoort. */
export function createSpeechSynthesizer(env: Env): SpeechSynthesizer {
  if (env.SPEECH_PROVIDER === 'http') {
    return new HttpSpeechSynthesizer(
      env.SPEECH_SERVICE_URL.replace(/\/+$/, ''),
      env.SPEECH_SERVICE_TOKEN,
      env.SPEECH_TIMEOUT_MS,
    );
  }
  return new UnavailableSynthesizer();
}

/** Cachesleutel: de stem én de tekst, gehasht zodat er geen zin als sleutel rondslingert. */
function cacheKey(text: string, voice: string): string {
  return createHash('sha256').update(`${voice}\n${text}`).digest('hex');
}

/**
 * De spraakdienst met een **geheugencache** ervoor. De AAC-labels, de vaste schermteksten en de
 * bedieningszinnen herhalen zich constant; een cachetreffer scheelt de hele synthese en het netwerk.
 *
 * Bewust alleen in het geheugen, met een harde bovengrens en zonder tekst in de sleutel: audio van wat
 * de gebruiker zei hoort niet op schijf (DESIGN §6.4). Herstart de server, dan is hij weg — dat is de
 * bedoeling.
 */
export function createSpeechService(
  env: Env,
  synthesizer: SpeechSynthesizer = createSpeechSynthesizer(env),
): SpeechService {
  const max = env.SPEECH_CACHE_MAX_ENTRIES;
  const cache = new Map<string, SpeechAudio>();

  return {
    get cacheSize() {
      return cache.size;
    },
    async speak(text: string, voice: string): Promise<SpeechAudio> {
      // De apparaatstem is geen model: die spreekt de tablet zelf uit. Vraagt een client er tóch om,
      // dan is dat een programmeerfout en geen synthese-opdracht.
      if (isDeviceVoice(voice)) {
        throw new HttpError(
          400,
          'SPEECH_VOICE_ON_DEVICE',
          'Deze stem spreekt het apparaat zelf uit; de server synthetiseert hem niet.',
        );
      }
      const key = cacheKey(text, voice);
      const hit = cache.get(key);
      if (hit) {
        // Opnieuw invoegen = jongste in de Map-volgorde, zodat het oudste fragment als eerste sneuvelt.
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }
      const fresh = await synthesizer.synthesize(text, voice);
      if (max > 0) {
        cache.set(key, fresh);
        while (cache.size > max) {
          const oldest = cache.keys().next();
          if (oldest.done) break;
          cache.delete(oldest.value);
        }
      }
      return fresh;
    },
  };
}
