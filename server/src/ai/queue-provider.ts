import type { PrismaClient } from '../generated/prisma/client.js';
import { AiWorkerBusyError, AiWorkerUnavailableError } from './errors.js';
import { enqueueJob, waitForJobResult, type JobTask, type QueueConfig } from './job-queue.js';
import {
  AI_TASK_GENERATE_MESSAGE,
  AI_TASK_SELECT_NEXT_QUESTION,
  aiMessageResultSchema,
  aiQuestionDecisionSchema,
  type AiCallMeta,
  type AiMessagePrompt,
  type AiMessageResult,
  type AiPrompt,
  type AiProvider,
  type AiQuestionDecision,
} from './provider.js';

/**
 * `QueueAiProvider` (T5.5, DESIGN §7.2, §9.2, ADR-0010): een `AiProvider` die aanvragen op de DB-wachtrij
 * zet i.p.v. ze in-process uit te voeren. Externe workers (T5.6) halen de jobs op en leveren
 * gestructureerde output terug via dezelfde zod-schema's (T5.1).
 *
 * De provider blijft achter de bestaande `AiProvider`-interface, zodat de orchestrator en de
 * validatielaag ongewijzigd blijven: **de uitvoer van een worker doorloopt exact dezelfde zod-parse en
 * AAC-validatie** als die van elke andere provider — een onbekend concept van een worker bereikt de
 * gebruiker nooit (DESIGN §7.6). Hier parsen we het worker-resultaat al één keer (nooit vertrouwen); de
 * orchestrator parset het daarna nogmaals.
 *
 * Bij backpressure (wachtrij vol) gooit de provider `AiWorkerBusyError` in plaats van te blokkeren; bij
 * time-out/mislukking `AiWorkerUnavailableError`. De centrale errorHandler mapt beide naar 503 met
 * `Retry-After`.
 */
export class QueueAiProvider implements AiProvider {
  readonly name = 'queue';

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: QueueConfig,
  ) {}

  async selectNextQuestion(prompt: AiPrompt, meta?: AiCallMeta): Promise<AiQuestionDecision> {
    // De strategiesleutel gaat mee de wachtrij in (T11.6) — niet de prompt in. Zo kan het beheerscherm
    // AI-activiteit tonen wélke aanpak draaide zonder dat er promptinhoud in beeld komt.
    const raw = await this.runJob(AI_TASK_SELECT_NEXT_QUESTION, prompt, meta?.strategy ?? null);
    return aiQuestionDecisionSchema.parse(raw);
  }

  async generateMessage(prompt: AiMessagePrompt): Promise<AiMessageResult> {
    const raw = await this.runJob(AI_TASK_GENERATE_MESSAGE, prompt);
    return aiMessageResultSchema.parse(raw);
  }

  /**
   * Zet de aanvraag op de wachtrij en wacht (pollend, begrensd) op een worker-resultaat. Gooit
   * `AiWorkerBusyError` als de wachtrij vol is (backpressure) en `AiWorkerUnavailableError` bij time-out,
   * mislukking of onleesbaar resultaat. Geeft de **rauwe** (JSON-geparste) worker-uitvoer terug; de
   * aanroeper valideert de vorm nogmaals met zod.
   */
  private async runJob(
    task: JobTask,
    payload: AiPrompt | AiMessagePrompt,
    strategy: string | null = null,
  ): Promise<unknown> {
    const admission = await enqueueJob(this.prisma, this.config, task, payload, strategy);
    if (admission.status === 'WAITING_FOR_WORKER') {
      throw new AiWorkerBusyError(admission.position, this.config.pollIntervalMs * 4);
    }

    const outcome = await waitForJobResult(this.prisma, this.config, admission.jobId);
    if (outcome.status !== 'SUCCEEDED') {
      throw new AiWorkerUnavailableError();
    }

    try {
      return JSON.parse(outcome.resultJson);
    } catch {
      // Zou niet mogen: het resultaat wordt op de worker-grens al als JSON gevalideerd opgeslagen.
      throw new AiWorkerUnavailableError('Onleesbaar worker-resultaat.');
    }
  }
}
