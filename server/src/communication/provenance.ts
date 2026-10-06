import { z } from 'zod';
import {
  agentDecisionSchema,
  inferenceSchema,
  presentationSchema,
  representationSchema,
  type AgentDecision,
  type Inference,
  type Presentation,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Encryptor } from '../crypto/encryption.js';

/**
 * Provenance: Presented, Observed en Inferred, plus de AI-beslissingen (INTENTO-NEW-DESIGN §26, §27,
 * §39, §41).
 *
 * De drie soorten staan in **eigen tabellen** en worden nooit samengevoegd: wat er getoond werd
 * (Presented) en wat de gebruiker deed (Observed) legt de backend vast; wat een agent concludeert
 * (Inferred) komt uit het antwoord van de agentdienst. Inhoud die iets over de gebruiker zegt
 * (schermtekst, labels, voorgestelde boodschap, payload van een inference) staat versleuteld; de
 * structuur (welke optie op welke plek, met welke representatie) blijft leesbaar voor Experience en
 * het operatoroverzicht.
 *
 * Lezen gaat altijd via het gesprek van één gebruiker binnen één organisatie (multi-tenant-isolatie).
 */

export const OBSERVED_TYPES = [
  'start',
  'answer_yes',
  'answer_no',
  'select_option',
  'none_of_these',
  'back',
  'stop',
] as const;
export type ObservedType = (typeof OBSERVED_TYPES)[number];

export interface ObservedInput {
  type: ObservedType;
  optionRef?: string | null;
  position?: number | null;
  responseTimeMs?: number | null;
}

/** De leesbare structuur van een getoonde optie: zonder label (dat staat versleuteld). */
const storedOptionSchema = z.strictObject({
  ref: z.string(),
  kind: z.enum(['symbol', 'contact']),
  vocabularyItemId: z.string().nullable(),
  contactId: z.string().nullable(),
  concept: z.string().nullable(),
  representation: representationSchema,
  position: z.number().int().nonnegative(),
});
export type StoredOption = z.infer<typeof storedOptionSchema>;

/** De versleutelde inhoud van een presentatie. */
const presentationContentSchema = z.strictObject({
  text: z.string(),
  message: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
});

export async function recordPresentation(
  prisma: PrismaClient,
  encryptor: Encryptor,
  sessionId: string,
  turn: number,
  presentation: Presentation,
): Promise<void> {
  const parsed = presentationSchema.parse(presentation);
  const options: StoredOption[] = parsed.options.map((option) => ({
    ref: option.ref,
    kind: option.kind,
    vocabularyItemId: option.vocabulary_item_id ?? null,
    contactId: option.contact_id ?? null,
    concept: option.concept ?? null,
    representation: option.representation,
    position: option.position,
  }));
  const content = {
    text: parsed.text,
    message: parsed.message ?? null,
    labels: Object.fromEntries(parsed.options.map((option) => [option.ref, option.label])),
  };
  await prisma.presentationEvent.create({
    data: {
      sessionId,
      turn,
      kind: parsed.kind,
      mode: parsed.mode,
      optionsJson: options,
      contentEncrypted: encryptor.encrypt(JSON.stringify(content)),
    },
  });
}

export async function recordObserved(
  prisma: PrismaClient,
  sessionId: string,
  turn: number,
  observed: ObservedInput,
): Promise<void> {
  await prisma.observedEvent.create({
    data: {
      sessionId,
      turn,
      type: observed.type,
      optionRef: observed.optionRef ?? null,
      position: observed.position ?? null,
      responseTimeMs: observed.responseTimeMs ?? null,
    },
  });
}

export async function recordInferences(
  prisma: PrismaClient,
  encryptor: Encryptor,
  sessionId: string,
  turn: number,
  inferences: Inference[],
): Promise<void> {
  if (inferences.length === 0) return;
  await prisma.inference.createMany({
    data: inferences.map((raw) => {
      const inference = inferenceSchema.parse(raw);
      return {
        sessionId,
        turn,
        agent: inference.agent,
        kind: inference.kind,
        payloadEncrypted: encryptor.encrypt(JSON.stringify(inference.payload)),
        confidence: inference.confidence ?? null,
      };
    }),
  });
}

/**
 * Legt de agentbeslissingen van een beurt vast. Verwierp de backend het antwoord (§51), dan geeft de
 * aanroeper `status: 'invalid'` en een reden mee; die overschrijven wat de agentdienst zelf meldde.
 */
export async function recordDecisions(
  prisma: PrismaClient,
  sessionId: string,
  turn: number,
  decisions: AgentDecision[],
  override?: { status: 'invalid'; reason: string },
): Promise<void> {
  if (decisions.length === 0) return;
  await prisma.agentDecision.createMany({
    data: decisions.map((raw) => {
      const decision = agentDecisionSchema.parse(raw);
      return {
        sessionId,
        turn,
        agent: decision.agent,
        status: override?.status ?? decision.status,
        model: decision.model ?? null,
        promptVersion: decision.prompt_version ?? null,
        latencyMs: decision.latency_ms,
        validation: override ? 'invalid' : (decision.validation ?? null),
        reason: override?.reason ?? decision.reason ?? null,
      };
    }),
  });
}

export interface ProvenanceRecord {
  presented: {
    turn: number;
    kind: string;
    mode: string;
    text: string;
    message: string | null;
    options: (StoredOption & { label: string | null })[];
  }[];
  observed: {
    turn: number;
    type: string;
    optionRef: string | null;
    position: number | null;
    responseTimeMs: number | null;
  }[];
  inferred: {
    turn: number;
    agent: string;
    kind: string;
    payload: unknown;
    confidence: number | null;
  }[];
  decisions: {
    turn: number;
    agent: string;
    status: string;
    model: string | null;
    promptVersion: string | null;
    latencyMs: number;
    validation: string | null;
    reason: string | null;
  }[];
}

/**
 * Leest de provenance van één gesprek, ontsleuteld. Alleen als het gesprek bij deze organisatie (en,
 * indien opgegeven, deze gebruiker) hoort; anders `null`.
 */
export async function readProvenance(
  prisma: PrismaClient,
  encryptor: Encryptor,
  scope: { sessionId: string; organizationId: string; userId?: string },
): Promise<ProvenanceRecord | null> {
  const session = await prisma.communicationSession.findFirst({
    where: {
      id: scope.sessionId,
      organizationId: scope.organizationId,
      ...(scope.userId ? { userId: scope.userId } : {}),
    },
    select: { id: true },
  });
  if (!session) return null;
  const where = { sessionId: session.id };
  const orderBy = [{ turn: 'asc' as const }, { createdAt: 'asc' as const }];
  const [presented, observed, inferred, decisions] = await Promise.all([
    prisma.presentationEvent.findMany({ where, orderBy }),
    prisma.observedEvent.findMany({ where, orderBy }),
    prisma.inference.findMany({ where, orderBy }),
    prisma.agentDecision.findMany({ where, orderBy }),
  ]);
  return {
    presented: presented.map((row) => {
      const content = presentationContentSchema.parse(
        JSON.parse(encryptor.decrypt(row.contentEncrypted)),
      );
      const options = z.array(storedOptionSchema).parse(row.optionsJson);
      return {
        turn: row.turn,
        kind: row.kind,
        mode: row.mode,
        text: content.text,
        message: content.message,
        options: options.map((option) => ({
          ...option,
          label: content.labels[option.ref] ?? null,
        })),
      };
    }),
    observed: observed.map((row) => ({
      turn: row.turn,
      type: row.type,
      optionRef: row.optionRef,
      position: row.position,
      responseTimeMs: row.responseTimeMs,
    })),
    inferred: inferred.map((row) => ({
      turn: row.turn,
      agent: row.agent,
      kind: row.kind,
      payload: JSON.parse(encryptor.decrypt(row.payloadEncrypted)) as unknown,
      confidence: row.confidence,
    })),
    decisions: decisions.map((row) => ({
      turn: row.turn,
      agent: row.agent,
      status: row.status,
      model: row.model,
      promptVersion: row.promptVersion,
      latencyMs: row.latencyMs,
      validation: row.validation,
      reason: row.reason,
    })),
  };
}
