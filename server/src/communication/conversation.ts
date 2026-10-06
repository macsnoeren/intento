import {
  AGENT_CONTRACT_VERSION,
  communicationTurnSchema,
  type AgentDecision,
  type AgentEvent,
  type AgentSettings,
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
  listAvailableVocabulary,
  toVocabularyEntry,
  type VocabularyItem,
} from '../vocabulary/repository.js';
import { signedAssetUrl } from '../vocabulary/assets.js';
import { createSession, endSession, saveTurn } from './sessions.js';
import {
  recordDecisions,
  recordInferences,
  recordObserved,
  recordPresentation,
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
  turn: number,
  presentation: Presentation,
  items: Map<string, VocabularyItem>,
  now: Date,
): CommunicationTurn {
  return communicationTurnSchema.parse({
    sessionId,
    turn,
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

  return toTabletTurn(deps.env, session.id, turn, response.presentation, items, now());
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
