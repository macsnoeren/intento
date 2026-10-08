import {
  AGENT_CONTRACT_VERSION,
  MAX_EXPERIENCE_SCREENS,
  experienceScreenSchema,
  interactionModeSchema,
  type ExperienceNote,
  type ExperienceRequest,
  type ExperienceScreen,
} from '@intento/shared';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Encryptor } from '../crypto/encryption.js';
import { AgentUnavailableError, type AgentClient } from '../agents/client.js';
import { readProvenance, recordDecisions } from '../communication/provenance.js';
import { toAgentSettings } from '../communication/conversation.js';
import { DEFAULT_PROFILE, profileFromModel } from '../users/serialize.js';

/**
 * Observaties na afloop van een gesprek (N12.4, INTENTO-NEW-DESIGN §21 laag 2).
 *
 * Als een gesprek eindigt, vraagt de backend de Experience Agent terug te kijken — zonder dat de tablet
 * wacht: de aanroeper start dit los van de beurt en een fout raakt het gesprek nooit. Wat terugkomt, is
 * een **observatie, geen waarheid**: bewaard als inference `experience_note` (versleuteld, binnen de
 * bewaartermijn, want het hoort bij het gesprek) en zo getoond in de beheeromgeving.
 *
 * Alleen als Experience voor de gebruiker aanstaat. Wat er naar de agentdienst gaat: de schermen met wat
 * de gebruiker deed, **zonder** de schermen over contacten (daar staan namen op; het contract kent ze
 * niet eens) en zonder contactopties. De backend controleert de observaties opnieuw: een observatie met
 * de naam van een contact van deze gebruiker of een URL wordt weggegooid.
 */

export const EXPERIENCE_AGENT = 'experience-agent';
export const EXPERIENCE_NOTE_KIND = 'experience_note';

const SCREEN_KINDS = new Set(['question', 'confirm_message', 'share_ask', 'ask_stop']);
const ANSWERS: Record<string, ExperienceScreen['answer']> = {
  answer_yes: 'yes',
  answer_no: 'no',
  select_option: 'selected',
  none_of_these: 'none_of_these',
  back: 'back',
  stop: 'stop',
};
const URL = /https?:\/\/|www\./i;

export const experienceNotePayloadSchema = z.object({
  notes: z.array(
    z.object({
      about: z.enum(['mode', 'question', 'symbol', 'flow']),
      text: z.string(),
      confidence: z.number(),
    }),
  ),
});

/** Het verzoek voor één afgerond gesprek, of `null` als er niets te bekijken is. */
export async function buildExperienceRequest(
  prisma: PrismaClient,
  encryptor: Encryptor,
  session: { id: string; userId: string; organizationId: string; status: string },
  settings: ExperienceRequest['settings'],
): Promise<ExperienceRequest | null> {
  const provenance = await readProvenance(prisma, encryptor, {
    sessionId: session.id,
    organizationId: session.organizationId,
    userId: session.userId,
  });
  if (!provenance) return null;
  // Per beurt wat de gebruiker deed (het eerste: een scherm wordt hooguit één keer beantwoord).
  const done = new Map<number, (typeof provenance.observed)[number]>();
  for (const event of provenance.observed) {
    if (event.type in ANSWERS && !done.has(event.turn)) done.set(event.turn, event);
  }
  const screens = provenance.presented
    .filter((screen) => SCREEN_KINDS.has(screen.kind))
    .map((screen) => {
      const event = done.get(screen.turn);
      return experienceScreenSchema.parse({
        turn: screen.turn,
        kind: screen.kind,
        mode: interactionModeSchema.catch('binary').parse(screen.mode),
        text: screen.text,
        options: screen.options
          .filter((option) => option.kind === 'symbol' && option.label)
          .map((option) => ({
            label: option.label,
            concept: option.concept,
            representation: option.representation,
            position: option.position,
          })),
        answer: event ? ANSWERS[event.type] : null,
        chosen_position: event?.type === 'select_option' ? event.position : null,
        response_time_ms: event?.responseTimeMs ?? null,
      });
    })
    .slice(-MAX_EXPERIENCE_SCREENS);
  if (screens.length === 0) return null;
  const sent = await prisma.delivery.count({ where: { sessionId: session.id, status: 'sent' } });
  return {
    contract_version: AGENT_CONTRACT_VERSION,
    session_id: session.id,
    settings,
    outcome: session.status === 'confirmed' ? 'confirmed' : 'stopped',
    sent: sent > 0,
    screens,
  };
}

/** Observaties die door de controle komen: geen contactnaam van deze gebruiker, geen URL. */
export function acceptableNotes(notes: ExperienceNote[], contactNames: string[]): ExperienceNote[] {
  const names = contactNames.map((name) => name.trim().toLowerCase()).filter(Boolean);
  return notes.filter((note) => {
    const text = note.text.toLowerCase();
    return !URL.test(note.text) && !names.some((name) => text.includes(name));
  });
}

/**
 * Laat de Experience Agent terugkijken op een afgerond gesprek en bewaart wat hij opmerkt. Doet niets
 * als het gesprek nog loopt, Experience uit staat of het al bekeken is. Een onbereikbare agentdienst
 * wordt als mislukte beslissing vastgelegd; andere fouten gaan naar de aanroeper (voor de log).
 */
export async function observeSession(
  deps: { prisma: PrismaClient; encryptor: Encryptor; agents: AgentClient },
  sessionId: string,
): Promise<'saved' | 'skipped' | 'failed'> {
  const { prisma, encryptor, agents } = deps;
  const session = await prisma.communicationSession.findUnique({
    where: { id: sessionId },
    include: { user: { include: { communicationProfile: true } } },
  });
  if (!session || session.endedAt === null) return 'skipped';
  const profile = session.user.communicationProfile
    ? profileFromModel(session.user.communicationProfile)
    : DEFAULT_PROFILE;
  if (!profile.experienceEnabled) return 'skipped';
  const seen = await prisma.inference.count({
    where: { sessionId, agent: EXPERIENCE_AGENT, kind: EXPERIENCE_NOTE_KIND },
  });
  if (seen > 0) return 'skipped';

  const request = await buildExperienceRequest(
    prisma,
    encryptor,
    session,
    toAgentSettings(profile),
  );
  if (!request) return 'skipped';

  const turn = session.currentTurn;
  let response;
  try {
    response = await agents.experience(request);
  } catch (error) {
    if (!(error instanceof AgentUnavailableError)) throw error;
    await recordDecisions(prisma, sessionId, turn, [
      {
        agent: EXPERIENCE_AGENT,
        status: 'failed',
        model: null,
        prompt_version: null,
        latency_ms: 0,
        validation: null,
        reason: error.reason,
      },
    ]);
    return 'failed';
  }

  const contacts = await prisma.contact.findMany({
    where: { userId: session.userId, organizationId: session.organizationId },
    select: { nameEncrypted: true },
  });
  const notes = acceptableNotes(
    response.notes,
    contacts.map((contact) => encryptor.decrypt(contact.nameEncrypted)),
  );
  await prisma.inference.create({
    data: {
      sessionId,
      turn,
      agent: EXPERIENCE_AGENT,
      kind: EXPERIENCE_NOTE_KIND,
      payloadEncrypted: encryptor.encrypt(JSON.stringify({ notes })),
      confidence: notes.length > 0 ? Math.max(...notes.map((note) => note.confidence)) : null,
    },
  });
  await recordDecisions(prisma, sessionId, turn, [response.decision]);
  return 'saved';
}
