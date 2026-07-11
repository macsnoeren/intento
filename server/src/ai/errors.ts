/**
 * Domeinfouten van de gedistribueerde AI-wachtrij (T5.5, ADR-0010). Bewust dependency-vrij zodat de
 * centrale `errorHandler` (errors.ts) ze kan herkennen zonder een import-cyclus met de AI-/DB-laag.
 *
 * De `QueueAiProvider` gooit deze in plaats van te blokkeren; de errorHandler mapt ze naar een 503 met
 * `Retry-After`, zodat de client een net "even wachten"-signaal krijgt (DESIGN §9.4: veiligheid boven
 * snelheid — de site blijft responsive onder druk).
 */

/**
 * Backpressure: het maximum aan gelijktijdige jobs is bereikt. De aanvraag staat als WAITING_FOR_WORKER
 * in de wachtrij; de client hoort even te wachten (positie meegegeven). → 503 AI_WORKER_BUSY.
 */
export class AiWorkerBusyError extends Error {
  constructor(
    /** Positie in de wachtrij (1-based) van de wachtende aanvraag. */
    readonly position: number,
    /** Voorgestelde wachttijd (ms) voordat de client opnieuw probeert. */
    readonly retryAfterMs: number,
  ) {
    super('Alle AI-workers zijn bezet; de aanvraag staat in de wachtrij.');
    this.name = 'AiWorkerBusyError';
  }
}

/**
 * Geen worker leverde binnen de tijd een (geldig) resultaat: time-out, mislukking of verlopen wachtrij-item.
 * → 503 AI_WORKER_UNAVAILABLE.
 */
export class AiWorkerUnavailableError extends Error {
  constructor(
    message = 'Er is momenteel geen AI-worker beschikbaar om de aanvraag te verwerken.',
    /** Voorgestelde wachttijd (ms) voordat de client opnieuw probeert. */
    readonly retryAfterMs = 5000,
  ) {
    super(message);
    this.name = 'AiWorkerUnavailableError';
  }
}
