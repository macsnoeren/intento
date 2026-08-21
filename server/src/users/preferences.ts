import {
  preferencePublicSchema,
  type PersonalContextCategory,
  type PreferencePublic,
  type PreferenceSuggestionStatus,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { PreferenceModel } from '../generated/prisma/models.js';
import type { AiUserContextItem } from '../ai/provider.js';

/**
 * Leermechanisme: geleerde voorkeuren (T6.3, DESIGN §3.8, §6.2 Preference, §7.1 taak 5, FR-014).
 *
 * De **Learning Engine** (DESIGN §7.2) werkt strikt binnen de domeinregels (CLAUDE.md, DESIGN §3.6):
 *
 *  - leert **alléén van bevestigde communicatie** (`/confirm`) — nooit van afgewezen voorstellen,
 *    correcties (§3.4 punt 4) of onzekere aannames;
 *  - is **uitschakelbaar** per gebruiker (`aiLearningEnabled`): staat de schakelaar uit, dan muteert er
 *    niets én komen bestaande voorkeuren ook niet in de AI-prompt;
 *  - bewaart **geen communicatie-inhoud**: alleen de canonieke AAC-conceptsleutel + een afgeleide
 *    zekerheid/teller (privacy by design, §9.4).
 *
 * Deze module is bewust vrij van HTTP: de gespreks- en beheerroutes roepen 'm aan, zodat het leren en de
 * suggestie-afhandeling deterministisch te testen zijn.
 */

/** Zekerheidswinst per bevestigde keuze; `count` × dit is de afgeleide `confidence`, geklemd op 1. */
export const CONFIDENCE_PER_CONFIRMATION = 0.2;

/**
 * Aantal bevestigingen waarna de begeleider een suggestie krijgt om het concept als persoonlijke context
 * toe te voegen (DESIGN §3.8). Bewust laag maar > 1 zodat één toevallige keuze nog geen suggestie triggert.
 */
export const SUGGESTION_THRESHOLD = 3;

/** Hoeveel top-voorkeuren maximaal in het AI-contextobject belanden (de prompt niet overladen). */
export const PREFERENCE_CONTEXT_LIMIT = 5;

/** De afgeleide zekerheid uit het aantal bevestigingen (geklemd op [0, 1]). */
export function confidenceForCount(count: number): number {
  return Math.min(1, Math.max(0, count * CONFIDENCE_PER_CONFIRMATION));
}

/**
 * Werkt de voorkeuren bij na een **bevestigde** boodschap (`/confirm`). Voor elk bevestigd concept wordt de
 * teller opgehoogd en de zekerheid opnieuw afgeleid. Zodra een concept de suggestie-drempel bereikt en er
 * nog geen suggestie voor liep (`suggestionStatus === 'none'`), gaat de status naar `pending` zodat de
 * begeleider het voorstel ziet (§3.8). Alles gebeurt **alléén** als de gebruiker leren heeft aanstaan —
 * anders is dit een no-op (DESIGN FR-014: uitschakelbaar).
 *
 * `concepts` bevat de canonieke AAC-conceptsleutels uit de bevestigde route; dubbele concepten in één
 * boodschap tellen als één bevestiging (via een set), zodat de teller de *aantal keer bevestigd*-betekenis
 * houdt. Correcties/afwijzingen komen hier nooit langs — die lopen via `/correction`/`/back` zonder te leren.
 */
export async function learnFromConfirmedConcepts(
  prisma: PrismaClient,
  userId: string,
  concepts: string[],
): Promise<void> {
  const profile = await prisma.userCommunicationProfile.findUnique({ where: { userId } });
  // Geen profiel of leren uit → niets muteren (uitschakelbaar, DESIGN FR-014).
  if (!profile || !profile.aiLearningEnabled) return;

  const unique = [...new Set(concepts)];
  for (const concept of unique) {
    const existing = await prisma.preference.findUnique({
      where: { userId_concept: { userId, concept } },
    });
    const nextCount = (existing?.count ?? 0) + 1;
    const confidence = confidenceForCount(nextCount);
    // De suggestie ontstaat één keer: bij het bereiken van de drempel en alléén als er nog geen suggestie
    // liep. Een eerder geweigerde (`dismissed`) of overgenomen (`accepted`) suggestie blijft zo staan.
    const suggestionStatus: PreferenceSuggestionStatus =
      existing?.suggestionStatus === 'none' || existing === null
        ? nextCount >= SUGGESTION_THRESHOLD
          ? 'pending'
          : 'none'
        : (existing.suggestionStatus as PreferenceSuggestionStatus);

    await prisma.preference.upsert({
      where: { userId_concept: { userId, concept } },
      create: {
        userId,
        concept,
        count: nextCount,
        confidence,
        source: 'confirmed_usage',
        suggestionStatus,
      },
      update: { count: nextCount, confidence, suggestionStatus },
    });
  }
}

/**
 * Laadt de voorkeuren als **AI-contextitems** (DESIGN §7.3: "wat past bij deze gebruiker"). Alléén als de
 * gebruiker leren heeft aanstaan (anders leeg — de toggle maakt de laag volledig inert). De sterkste
 * voorkeuren eerst, begrensd op `PREFERENCE_CONTEXT_LIMIT` zodat de prompt niet volloopt. De waarde is het
 * AAC-`label` (leesbaar), met terugval op het concept als het symbool intussen verwijderd is.
 */
export async function loadPreferenceContext(
  prisma: PrismaClient,
  userId: string,
): Promise<AiUserContextItem[]> {
  const profile = await prisma.userCommunicationProfile.findUnique({ where: { userId } });
  if (!profile || !profile.aiLearningEnabled) return [];

  const prefs = await prisma.preference.findMany({
    where: { userId },
    orderBy: [{ confidence: 'desc' }, { count: 'desc' }, { concept: 'asc' }],
    take: PREFERENCE_CONTEXT_LIMIT,
  });
  if (prefs.length === 0) return [];

  const labelByConcept = await labelMapFor(
    prisma,
    prefs.map((p) => p.concept),
  );
  return prefs.map((pref) => ({
    kind: 'preference',
    value: labelByConcept.get(pref.concept) ?? pref.concept,
  }));
}

/** Zoekt de AAC-labels bij een set concepten op (voor de leesbare weergave in prompt en beheer-UI). */
async function labelMapFor(prisma: PrismaClient, concepts: string[]): Promise<Map<string, string>> {
  if (concepts.length === 0) return new Map();
  const symbols = await prisma.aacSymbol.findMany({
    where: { concept: { in: concepts } },
    select: { concept: true, label: true },
  });
  return new Map(symbols.map((s) => [s.concept, s.label]));
}

/** Serialiseert een voorkeur-rij naar de publieke vorm; `label` wordt door de aanroeper opgezocht. */
export function preferenceToPublic(pref: PreferenceModel, label: string): PreferencePublic {
  return preferencePublicSchema.parse({
    id: pref.id,
    userId: pref.userId,
    concept: pref.concept,
    label,
    confidence: pref.confidence,
    count: pref.count,
    suggestionStatus: pref.suggestionStatus,
    suggested: pref.suggestionStatus === 'pending',
    createdAt: pref.createdAt.toISOString(),
  });
}

/**
 * Alle voorkeuren van een gebruiker als publieke lijst, sterkste eerst, met opgezochte labels. Gedeeld door
 * de lijst-route en de suggestie-afhandeling (die de bijgewerkte rij teruggeeft).
 */
export async function listPreferences(
  prisma: PrismaClient,
  userId: string,
): Promise<PreferencePublic[]> {
  const prefs = await prisma.preference.findMany({
    where: { userId },
    orderBy: [{ confidence: 'desc' }, { count: 'desc' }, { concept: 'asc' }],
  });
  const labelByConcept = await labelMapFor(
    prisma,
    prefs.map((p) => p.concept),
  );
  return prefs.map((pref) =>
    preferenceToPublic(pref, labelByConcept.get(pref.concept) ?? pref.concept),
  );
}

/**
 * Vertaalt de categorie van een voorgesteld AAC-concept naar een passende persoonlijke-context-categorie
 * (voor de standaard bij `accept`). De taxonomieën verschillen; onbekende/afwijkende categorieën vallen
 * netjes terug op `OTHER`. De begeleider kan de standaard altijd via `adjust` overschrijven.
 */
export function contextCategoryForAac(aacCategory: string | null): PersonalContextCategory {
  switch (aacCategory) {
    case 'person':
      return 'PERSON';
    case 'animal':
      return 'PET';
    case 'place':
      return 'PLACE';
    case 'activity':
      return 'ACTIVITY';
    case 'food':
    case 'drink':
      return 'FOOD';
    case 'object':
      return 'OBJECT';
    default:
      return 'OTHER';
  }
}
