import {
  AGENT_CONTRACT_VERSION,
  communicationTurnSchema,
  type AgentDecision,
  type AgentEvent,
  type AgentSettings,
  type AnswerRequest,
  type CommunicationProfile,
  type CommunicationTurn,
  type Presentation,
  type SessionState,
  type TurnRequest,
  type TurnResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { CommunicationSessionModel, DeviceModel } from '../generated/prisma/models.js';
import type { Env } from '../env.js';
import type { Encryptor } from '../crypto/encryption.js';
import { HttpError } from '../errors.js';
import { AgentUnavailableError, type AgentClient } from '../agents/client.js';
import { checkTurnResponse } from '../agents/invariants.js';
import { DEFAULT_PROFILE, profileFromModel } from '../users/serialize.js';
import {
  availableTo,
  listAvailableVocabulary,
  parseVocabularyItem,
  toVocabularyEntry,
  type VocabularyItem,
} from '../vocabulary/repository.js';
import { signedAssetUrl } from '../vocabulary/assets.js';
import {
  createSession,
  endSession,
  findActiveSession,
  findSessionForUser,
  lastTurnNumber,
  loadTurn,
  saveTurn,
} from './sessions.js';
import {
  recordDecisions,
  recordInferences,
  recordObserved,
  recordPresentation,
  type ObservedInput,
} from './provenance.js';

/**
 * Eén beurt van een gesprek (INTENTO-NEW-DESIGN §3.1, §26, §51, §52).
 *
 * De backend doet per beurt hetzelfde: vastleggen wat de gebruiker deed (Observed, vóór de
 * agentaanroep, zodat het er ook staat als de agent faalt), de agentdienst alles geven wat hij nodig
 * heeft, het antwoord toetsen aan de harde invarianten, en pas dan opslaan (momentopname, Presented,
 * Inferred, beslissingen) en aan de tablet laten zien. Faalt de agent of schendt hij een invariant,
 * dan wordt dat als `AgentDecision` vastgelegd en krijgt de tablet 503 `AGENT_UNAVAILABLE`
 * ("Even geen hulp", §48).
 */

export interface ConversationDeps {
  prisma: PrismaClient;
  env: Env;
  encryptor: Encryptor;
  agents: AgentClient;
  now?: () => Date;
}

/** De gebruiker achter een apparaat, met zijn instellingen. */
export interface ConversationUser {
  id: string;
  organizationId: string;
  profile: CommunicationProfile;
}

export async function loadConversationUser(
  prisma: PrismaClient,
  device: DeviceModel,
): Promise<ConversationUser> {
  const user = await prisma.user.findUnique({
    where: { id: device.userId },
    include: { communicationProfile: true },
  });
  if (!user) throw new HttpError(401, 'DEVICE_NOT_LINKED', 'Geen gekoppeld apparaat.');
  return {
    id: user.id,
    organizationId: user.organizationId,
    profile: user.communicationProfile
      ? profileFromModel(user.communicationProfile)
      : DEFAULT_PROFILE,
  };
}

export function toAgentSettings(profile: CommunicationProfile): AgentSettings {
  return {
    interaction_mode: profile.interactionMode,
    options_per_screen: profile.optionsPerScreen,
    question_strategy: profile.questionStrategy,
    max_questions: profile.maxQuestions,
    experience_enabled: profile.experienceEnabled,
  };
}

/** De presentatie zoals de tablet hem krijgt: zonder concepten of ids, met ondertekende URL's. */
export function toTabletTurn(
  env: Env,
  sessionId: string,
  snapshot: { turn: number; previousTurn: number | null; state: SessionState },
  presentation: Presentation,
  items: Map<string, VocabularyItem>,
  now: Date,
): CommunicationTurn {
  return communicationTurnSchema.parse({
    sessionId,
    turn: snapshot.turn,
    canGoBack: snapshot.previousTurn !== null && snapshot.state.share.sent_to.length === 0,
    presentation: {
      kind: presentation.kind,
      mode: presentation.mode,
      text: presentation.text,
      message: presentation.message ?? null,
      options: presentation.options.map((option) => {
        const item = option.vocabulary_item_id ? items.get(option.vocabulary_item_id) : undefined;
        return {
          ref: option.ref,
          kind: option.kind,
          label: option.label,
          imageUrl: item?.assetPath ? signedAssetUrl(env, item, now) : null,
          representation: option.representation,
          position: option.position,
        };
      }),
    },
  });
}

interface AgentTurnInput {
  session: CommunicationSessionModel;
  user: ConversationUser;
  turn: number;
  previousTurn: number | null;
  event: AgentEvent;
  state: SessionState | null;
}

/**
 * Roept de agentdienst aan voor één beurt en slaat het resultaat op. Observed moet de aanroeper al
 * vastgelegd hebben. Gooit `AgentUnavailableError` (503) als de agent faalt of een invariant schendt.
 */
export async function runAgentTurn(
  deps: ConversationDeps,
  input: AgentTurnInput,
): Promise<CommunicationTurn> {
  const { prisma, encryptor, agents } = deps;
  const now = deps.now ?? (() => new Date());
  const { session, user, turn } = input;

  const vocabulary = await listAvailableVocabulary(prisma, user.organizationId);
  if (vocabulary.length === 0) {
    throw new HttpError(503, 'VOCABULARY_EMPTY', 'Er zijn nog geen symbolen om mee te praten.');
  }
  const items = new Map(vocabulary.map((item) => [item.id, item]));

  const request: TurnRequest = {
    contract_version: AGENT_CONTRACT_VERSION,
    session_id: session.id,
    turn,
    event: input.event,
    state: input.state,
    settings: toAgentSettings(user.profile),
    vocabulary: vocabulary.map(toVocabularyEntry),
    // Contacten (N10) en Experience (N8) komen later mee; namen en e-mail gaan nooit naar een LLM.
    contacts: [],
    experience: null,
  };

  const started = Date.now();
  let response: TurnResponse;
  try {
    response = await agents.turn(request);
  } catch (error) {
    if (error instanceof AgentUnavailableError) {
      await recordDecisions(prisma, session.id, turn, [
        failedDecision(error.reason, Date.now() - started),
      ]);
    }
    throw error;
  }

  const violations = checkTurnResponse(request, response);
  if (violations.length > 0) {
    const reason = violations
      .map((violation) => `${violation.invariant}: ${violation.message}`)
      .join('; ')
      .slice(0, 300);
    await recordDecisions(
      prisma,
      session.id,
      turn,
      response.decisions.length > 0
        ? response.decisions
        : [failedDecision('invariant_violation', Date.now() - started)],
      { status: 'invalid', reason },
    );
    throw new AgentUnavailableError('invariant_violation', reason);
  }

  await saveTurn(prisma, encryptor, session.id, {
    turn,
    previousTurn: input.previousTurn,
    state: response.state,
    presentation: response.presentation,
  });
  await recordPresentation(prisma, encryptor, session.id, turn, response.presentation);
  await recordInferences(prisma, encryptor, session.id, turn, response.inferences);
  await recordDecisions(prisma, session.id, turn, response.decisions);
  // JA op "Wil je stoppen?": de agent sloot het gesprek af, dus het gesprek is voorbij.
  if (response.presentation.kind === 'stopped') {
    await endSession(prisma, session.id, 'stopped', now());
  }

  return toTabletTurn(
    deps.env,
    session.id,
    { turn, previousTurn: input.previousTurn, state: response.state },
    response.presentation,
    items,
    now(),
  );
}

/** Een beslissing namens de backend als de agentdienst zelf niets bruikbaars teruggaf. */
function failedDecision(reason: string, latencyMs: number): AgentDecision {
  return {
    agent: 'agent-service',
    status: 'failed',
    model: null,
    prompt_version: null,
    latency_ms: latencyMs,
    validation: null,
    reason,
  };
}

/**
 * Start een gesprek: een lopend gesprek van deze gebruiker wordt `stopped`, er komt een nieuw gesprek,
 * en de agentdienst bepaalt het eerste scherm. Lukt dat niet, dan wordt het nieuwe gesprek meteen
 * weer gestopt (er is geen scherm om naar terug te keren) en volgt 503; "Opnieuw proberen" start
 * gewoon opnieuw.
 */
export async function startConversation(
  deps: ConversationDeps,
  device: DeviceModel,
): Promise<CommunicationTurn> {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());
  const user = await loadConversationUser(prisma, device);

  const running = await prisma.communicationSession.findMany({
    where: { userId: user.id, status: 'active' },
    select: { id: true },
  });
  for (const { id } of running) await endSession(prisma, id, 'stopped', now());

  const session = await createSession(prisma, {
    userId: user.id,
    organizationId: user.organizationId,
  });
  await recordObserved(prisma, session.id, 0, { type: 'start' });
  try {
    return await runAgentTurn(deps, {
      session,
      user,
      turn: 0,
      previousTurn: null,
      event: { type: 'start' },
      state: null,
    });
  } catch (error) {
    await endSession(prisma, session.id, 'stopped', now());
    throw error;
  }
}

/** Schermen waarop de gebruiker kiest uit opties (en waar multi-icon dus tegels toont). */
const CHOICE_KINDS = new Set(['question', 'share_contact']);

/** Wat de gebruiker op dit scherm mag antwoorden, en welke gebeurtenis dat voor de agent is. */
function toEvent(
  presentation: Presentation,
  body: AnswerRequest,
): { event: AgentEvent; observed: ObservedInput } {
  if (presentation.kind === 'done' || presentation.kind === 'stopped') {
    throw new HttpError(409, 'NOTHING_TO_ANSWER', 'Op dit scherm valt niets te antwoorden.');
  }
  const tiles = presentation.mode === 'multi' && CHOICE_KINDS.has(presentation.kind);
  const responseTimeMs = body.responseTimeMs ?? null;

  if ('answer' in body) {
    if (tiles) {
      throw new HttpError(400, 'ANSWER_NOT_ALLOWED', 'Kies een tegel of "Geen van deze".');
    }
    const shown = presentation.options[0];
    const type = body.answer === 'yes' ? 'answer_yes' : 'answer_no';
    return {
      event: { type },
      observed: {
        type,
        optionRef: shown?.ref ?? null,
        position: shown?.position ?? null,
        responseTimeMs,
      },
    };
  }
  if (!tiles) {
    throw new HttpError(400, 'ANSWER_NOT_ALLOWED', 'Dit scherm vraagt JA of NEE.');
  }
  if ('optionRef' in body) {
    const chosen = presentation.options.find((option) => option.ref === body.optionRef);
    if (!chosen) {
      throw new HttpError(400, 'UNKNOWN_OPTION', 'Die keuze stond niet op het scherm.');
    }
    return {
      event: { type: 'select_option', option_ref: chosen.ref },
      observed: {
        type: 'select_option',
        optionRef: chosen.ref,
        position: chosen.position,
        responseTimeMs,
      },
    };
  }
  return {
    event: { type: 'none_of_these' },
    observed: { type: 'none_of_these', responseTimeMs },
  };
}

/** Het lopende gesprek van de gebruiker achter dit apparaat; anders 404 of 409. */
export async function loadActiveSession(
  prisma: PrismaClient,
  device: DeviceModel,
  sessionId: string,
): Promise<CommunicationSessionModel> {
  const session = await findSessionForUser(prisma, sessionId, device.userId);
  if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Gesprek niet gevonden.');
  if (session.status !== 'active') {
    throw new HttpError(409, 'SESSION_ENDED', 'Dit gesprek is al afgelopen.');
  }
  return session;
}

/**
 * Een antwoord op het huidige scherm. Observed staat vast vóór de agentaanroep, zodat het er ook is
 * als de agent faalt; het hoort bij de beurt van het scherm dat beantwoord werd. Het nieuwe scherm
 * krijgt het volgende beurtnummer (beurten zijn append-only).
 */
export async function answerConversation(
  deps: ConversationDeps,
  device: DeviceModel,
  sessionId: string,
  body: AnswerRequest,
): Promise<CommunicationTurn> {
  const { prisma, encryptor } = deps;
  const session = await loadActiveSession(prisma, device, sessionId);
  if (body.turn !== session.currentTurn) {
    throw new HttpError(409, 'STALE_TURN', 'Dit scherm is al beantwoord.');
  }
  const current = await loadTurn(prisma, encryptor, session.id, session.currentTurn);
  if (!current) throw new HttpError(409, 'STALE_TURN', 'Dit scherm is al beantwoord.');

  const { event, observed } = toEvent(current.presentation, body);
  await recordObserved(prisma, session.id, current.turn, observed);

  const user = await loadConversationUser(prisma, device);
  return runAgentTurn(deps, {
    session,
    user,
    turn: (await lastTurnNumber(prisma, session.id)) + 1,
    previousTurn: current.turn,
    event,
    state: current.state,
  });
}

/** De Vocabulary-items die op dit scherm staan (alleen beschikbaar en `approved`), voor de afbeeldingen. */
async function itemsOnScreen(
  prisma: PrismaClient,
  organizationId: string,
  presentation: Presentation,
): Promise<Map<string, VocabularyItem>> {
  const ids = presentation.options
    .map((option) => option.vocabulary_item_id)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return new Map();
  const rows = await prisma.vocabularyItem.findMany({
    where: { id: { in: ids }, status: 'approved', ...availableTo(organizationId) },
  });
  return new Map(rows.map((row) => [row.id, parseVocabularyItem(row)]));
}

/**
 * ↩ Terug (§48): het laatste antwoord ongedaan maken en het vorige scherm **exact** terugzetten, zonder
 * de agentdienst. Beurten zijn append-only, dus Terug maakt een nieuwe beurt met de momentopname van de
 * vorige; die wijst zelf weer naar de beurt daarvoor, zodat nog eens Terug verder teruggaat. Niet op
 * het eerste scherm, en niet meer na een verzending (een verstuurd bericht is niet terug te halen).
 */
export async function goBack(
  deps: ConversationDeps,
  device: DeviceModel,
  sessionId: string,
  turn: number,
): Promise<CommunicationTurn> {
  const { prisma, encryptor, env } = deps;
  const now = deps.now ?? (() => new Date());
  const session = await loadActiveSession(prisma, device, sessionId);
  if (turn !== session.currentTurn) {
    throw new HttpError(409, 'STALE_TURN', 'Dit scherm is al beantwoord.');
  }
  const current = await loadTurn(prisma, encryptor, session.id, session.currentTurn);
  if (!current) throw new HttpError(409, 'STALE_TURN', 'Dit scherm is al beantwoord.');
  if (current.previousTurn === null) {
    throw new HttpError(409, 'CANNOT_GO_BACK', 'Dit is het eerste scherm.');
  }
  if (current.state.share.sent_to.length > 0) {
    throw new HttpError(409, 'CANNOT_GO_BACK', 'Het bericht is al verstuurd.');
  }
  const previous = await loadTurn(prisma, encryptor, session.id, current.previousTurn);
  if (!previous) throw new HttpError(409, 'CANNOT_GO_BACK', 'Het vorige scherm bestaat niet meer.');

  await recordObserved(prisma, session.id, current.turn, { type: 'back' });
  const next = (await lastTurnNumber(prisma, session.id)) + 1;
  await saveTurn(prisma, encryptor, session.id, {
    turn: next,
    previousTurn: previous.previousTurn,
    state: previous.state,
    presentation: previous.presentation,
  });
  await recordPresentation(prisma, encryptor, session.id, next, previous.presentation);

  const items = await itemsOnScreen(prisma, session.organizationId, previous.presentation);
  return toTabletTurn(
    env,
    session.id,
    { turn: next, previousTurn: previous.previousTurn, state: previous.state },
    previous.presentation,
    items,
    now(),
  );
}

/** ⏹ Stoppen (§48): het gesprek eindigt; er wordt niets vastgesteld of verstuurd. */
export async function stopConversation(
  deps: ConversationDeps,
  device: DeviceModel,
  sessionId: string,
): Promise<void> {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());
  const session = await loadActiveSession(prisma, device, sessionId);
  await recordObserved(prisma, session.id, session.currentTurn, { type: 'stop' });
  await endSession(prisma, session.id, 'stopped', now());
}

/**
 * Het lopende gesprek hervatten (na herladen of een herstart van de tablet): precies het scherm dat er
 * stond, met verse afbeeldings-URL's. Geen lopend gesprek → `null`; een gestopt of afgerond gesprek
 * wordt nooit hervat.
 */
export async function currentConversation(
  deps: ConversationDeps,
  device: DeviceModel,
): Promise<CommunicationTurn | null> {
  const { prisma, encryptor, env } = deps;
  const now = deps.now ?? (() => new Date());
  const session = await findActiveSession(prisma, device.userId);
  if (!session) return null;
  const current = await loadTurn(prisma, encryptor, session.id, session.currentTurn);
  if (!current) return null;
  const items = await itemsOnScreen(prisma, session.organizationId, current.presentation);
  return toTabletTurn(env, session.id, current, current.presentation, items, now());
}
