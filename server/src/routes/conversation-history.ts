import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  conversationListResponseSchema,
  conversationTranscriptResponseSchema,
  type ConversationListResponse,
  type ConversationTranscriptResponse,
  type ConversationTranscriptOption,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type {
  AacSymbolModel,
  ConversationSessionModel,
  ConversationStepModel,
} from '../generated/prisma/models.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant } from '../auth/tenant.js';
import { assertCaregiverAccess } from '../auth/caregivers.js';
import { imageUrlFor } from '../aac/library.js';
import { findStrategy } from '../conversation/strategy.js';
import { readOfferedConcepts } from '../conversation/offer.js';
import { HttpError } from '../errors.js';

/**
 * Gespreksverloop terugzien (T12.1, DESIGN §3.1, §3.6, §9.1, §9.4).
 *
 * **Waarom deze routes bestaan.** Na elke gebruikerstest is de vraag dezelfde: *wat gebeurde er nou
 * eigenlijk?* Dat was alleen te reconstrueren uit losse brokken — het AI-activiteitscherm toont de
 * laatste jobs zonder te weten bij welk gesprek ze horen, de tablet toont alleen het hier-en-nu, en de
 * rest zit in de server-logs. Wie wil begrijpen waarom een gesprek ergens afsloeg, moest drie plekken
 * naast elkaar leggen.
 *
 * Alles wat daarvoor nodig is, ligt al vast. `ConversationStep` bewaart per stap de **getoonde vraag**,
 * de **aangeboden concepten** (`offeredConcepts`, T10.3) en de **keuze van de gebruiker**. Er is dus geen
 * nieuwe opslag nodig om een gesprek terug te lezen — alleen een manier om het te tonen. Dat is bewust:
 * meer bewaren om beter te kunnen debuggen zou tegen §3.6 in gaan.
 *
 * **De grens.** Een gesprek is communicatie van de gebruiker en blijft binnen de organisatie: ADMIN en
 * CAREGIVER, tenant-gefilterd (`assertSameTenant`) en voor een begeleider beperkt tot **gekoppelde**
 * gebruikers (`assertCaregiverAccess`, T2.2) — exact dezelfde grens als de voorkeuren- en
 * persoonlijke-context-API. Het platformbrede AI-activiteitscherm blijft daarnaast bestaan met alleen
 * infrastructuur en wat de AI voorstelde (T9.15/T12.2); die twee schuiven niet in elkaar.
 *
 * **Wat er niet in zit.** De prompt (daar zit persoonlijke context in, §9.4), de hypothese van de AI en
 * afgewezen boodschappen. Een correctie verschijnt als gebeurtenis ("hier zei de gebruiker nee op dit
 * concept"), niet als de boodschap die hij afwees — die wordt nooit opgeslagen (§3.6).
 */

/** Query op de gesprekslijst: hoeveel gesprekken (nieuwste eerst). Begrensd zodat de lijst eindig blijft. */
const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25),
});

const userParamsSchema = z.object({ id: z.string().min(1) });
const sessionParamsSchema = z.object({ id: z.string().min(1) });

/** De samenvattingsvelden van één sessie, gedeeld door de lijst en het verloop. */
function summarize(
  session: ConversationSessionModel,
  stepCount: number,
  correctionCount: number,
  message: string | null,
): Omit<ConversationTranscriptResponse, 'steps' | 'corrections'> {
  // Een opgeslagen sleutel die de registry niet meer kent, valt weg in plaats van een half label op te
  // leveren — dezelfde omgang als bij het resolven van de strategie zelf (T11.5).
  const strategy = findStrategy(session.strategy);
  return {
    id: session.id,
    status: session.status as ConversationTranscriptResponse['status'],
    mode: session.mode,
    caregiverQuestion: session.caregiverQuestion,
    strategy: strategy ? { key: strategy.key, label: strategy.label } : null,
    startedAt: session.startedAt.toISOString(),
    stepCount,
    correctionCount,
    message,
  };
}

/**
 * Zet één stap om naar de terugblik: de aangeboden concepten in de getoonde volgorde, met de keuze van
 * de gebruiker gemarkeerd.
 *
 * Twee dingen worden hier bewust *niet* gladgestreken. Een concept dat intussen uit de bibliotheek is
 * verdwenen (T10.7: samengevoegd of verwijderd) blijft als sleutel staan met `missing: true` — het
 * weglaten zou een terugblik opleveren die niet klopt met wat de gebruiker zag. En stond de keuze niet in
 * het vastgelegde aanbod (stappen van vóór T10.3, toen het aanbod nog niet werd bewaard), dan wordt ze
 * alsnog als gekozen optie toegevoegd, zodat elke stap laat zien wat er is aangetikt.
 */
function transcriptStep(
  step: ConversationStepModel,
  symbolByConcept: Map<string, AacSymbolModel>,
): ConversationTranscriptResponse['steps'][number] {
  const concepts = readOfferedConcepts(step.offeredConcepts);
  const shown = concepts.includes(step.selectedConcept)
    ? concepts
    : [...concepts, step.selectedConcept];

  const options: ConversationTranscriptOption[] = shown.map((concept) => {
    const symbol = symbolByConcept.get(concept);
    const chosen = concept === step.selectedConcept;
    if (!symbol) {
      return {
        concept,
        label: concept,
        glyph: '❔',
        imageUrl: null,
        isNew: false,
        chosen,
        missing: true,
      };
    }
    return {
      concept,
      label: symbol.label,
      glyph: symbol.glyph,
      imageUrl: imageUrlFor(symbol.id, symbol.imageVersion),
      isNew: symbol.origin === 'ai' && symbol.reviewStatus === 'PENDING',
      chosen,
      missing: false,
    };
  });

  return {
    order: step.order,
    question: step.question,
    options,
    chosenConcept: step.selectedConcept,
    confidence: step.confidence,
    at: step.createdAt.toISOString(),
  };
}

export interface ConversationHistoryRoutesDeps {
  prisma: PrismaClient;
}

export function registerConversationHistoryRoutes(
  app: FastifyInstance,
  { prisma }: ConversationHistoryRoutesDeps,
): void {
  // Lijst van gesprekken van één gebruiker — ADMIN + CAREGIVER (gekoppeld), tenant-gefilterd.
  app.get(
    '/admin/users/:id/conversations',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<ConversationListResponse> => {
      const account = requireAccount(request);
      const { id } = userParamsSchema.parse(request.params);
      const { limit } = listQuerySchema.parse(request.query);

      const user = await prisma.user.findUnique({ where: { id } });
      assertSameTenant(account, user);
      await assertCaregiverAccess(prisma, account, id);

      const sessions = await prisma.conversationSession.findMany({
        where: { userId: id },
        orderBy: { startedAt: 'desc' },
        take: limit,
        include: {
          _count: { select: { steps: true, corrections: true } },
          messages: { where: { confirmed: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      return conversationListResponseSchema.parse({
        conversations: sessions.map((session) =>
          summarize(
            session,
            session._count.steps,
            session._count.corrections,
            session.messages[0]?.message ?? null,
          ),
        ),
      });
    },
  );

  // Het verloop van één gesprek — dezelfde grens. De sessie wordt via haar **gebruiker** gecontroleerd:
  // een sessie-id uit een andere organisatie is daarmee net zo onbereikbaar als een onbestaand id.
  app.get(
    '/admin/conversations/:id',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<ConversationTranscriptResponse> => {
      const account = requireAccount(request);
      const { id } = sessionParamsSchema.parse(request.params);

      const session = await prisma.conversationSession.findUnique({
        where: { id },
        include: { user: true },
      });
      // Bewust **dezelfde** 403 voor "bestaat niet" en "hoort bij een andere organisatie" — zoals
      // `assertSameTenant` dat doet. Een 404 hier zou verraden dat het gesprek bestaat, en daarmee zou
      // een reeks id's het bestaan van gesprekken in andere organisaties blootleggen (IDOR).
      if (!session)
        throw new HttpError(403, 'FORBIDDEN', 'Je hebt geen toegang tot deze resource.');
      assertSameTenant(account, session.user);
      await assertCaregiverAccess(prisma, account, session.userId);

      const [steps, corrections, messages] = await Promise.all([
        prisma.conversationStep.findMany({ where: { sessionId: id }, orderBy: { order: 'asc' } }),
        prisma.correctionEvent.findMany({
          where: { sessionId: id },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.generatedMessage.findMany({
          where: { sessionId: id, confirmed: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        }),
      ]);

      // Alle betrokken concepten in één query: zowel het aanbod als de keuzes, zodat een stap met een
      // inmiddels verwijderd symbool geen extra rondje kost.
      const concepts = new Set<string>();
      for (const step of steps) {
        concepts.add(step.selectedConcept);
        for (const concept of readOfferedConcepts(step.offeredConcepts)) concepts.add(concept);
      }
      const symbols =
        concepts.size > 0
          ? await prisma.aacSymbol.findMany({ where: { concept: { in: [...concepts] } } })
          : [];
      const symbolByConcept = new Map(symbols.map((symbol) => [symbol.concept, symbol]));

      return conversationTranscriptResponseSchema.parse({
        ...summarize(session, steps.length, corrections.length, messages[0]?.message ?? null),
        steps: steps.map((step) => transcriptStep(step, symbolByConcept)),
        corrections: corrections.map((correction) => ({
          type: correction.type,
          stepOrder: correction.stepOrder,
          rejectedConcept: correction.rejectedConcept,
          at: correction.createdAt.toISOString(),
        })),
      });
    },
  );
}
