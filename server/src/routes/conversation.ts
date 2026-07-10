import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  conversationChoiceRequestSchema,
  conversationChoiceResponseSchema,
  conversationConfirmResponseSchema,
  conversationGenerateResponseSchema,
  conversationStateResponseSchema,
  type ConversationChoiceResponse,
  type ConversationConfirmResponse,
  type ConversationGenerateResponse,
  type ConversationStateResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type {
  AacSymbolModel,
  ConversationSessionModel,
  ConversationStepModel,
} from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { deviceAuthorize, requireDevice } from '../auth/device.js';
import { currentQuestion, resolveOption, serializeHistory } from '../conversation/engine.js';
import {
  generateMessage,
  SCRIPTED_CONFIDENCE,
  type ChosenConcept,
} from '../conversation/message.js';
import { symbolToPublic } from '../aac/library.js';

export interface ConversationRoutesDeps {
  prisma: PrismaClient;
}

/** Route-parameter: het sessie-id uit het pad. */
const sessionParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Laadt een sessie en dwingt **gebruiker-isolatie** af: het gekoppelde apparaat mag alléén de sessies
 * van zijn eigen gebruiker zien. Een sessie van een andere gebruiker geeft `404` (bewust géén 403 —
 * het bestaan lekt niet naar een ander apparaat/gebruiker). Zie DESIGN §9.4.
 */
async function loadOwnedSession(
  prisma: PrismaClient,
  userId: string,
  id: string,
): Promise<ConversationSessionModel> {
  const session = await prisma.conversationSession.findUnique({ where: { id } });
  if (!session || session.userId !== userId) {
    throw new HttpError(404, 'SESSION_NOT_FOUND', 'Gesprek bestaat niet.');
  }
  return session;
}

/** Alle stappen van een sessie, oplopend op `order` (de volgorde waarin ze gekozen zijn). */
function loadSteps(prisma: PrismaClient, sessionId: string): Promise<ConversationStepModel[]> {
  return prisma.conversationStep.findMany({ where: { sessionId }, orderBy: { order: 'asc' } });
}

/** Bouwt de geserialiseerde historie: laadt de bij de stappen horende symbolen en koppelt ze. */
async function buildHistory(prisma: PrismaClient, steps: ConversationStepModel[]) {
  const ids = steps.map((step) => step.selectedSymbolId).filter((id): id is string => id !== null);
  const symbols =
    ids.length > 0 ? await prisma.aacSymbol.findMany({ where: { id: { in: ids } } }) : [];
  const byId = new Map<string, AacSymbolModel>(symbols.map((symbol) => [symbol.id, symbol]));
  return serializeHistory(steps, byId);
}

/**
 * Bouwt de invoer voor de boodschapgeneratie uit de opgeslagen stappen: de pictogramreeks (publieke
 * symbolen, op volgorde) en de gekozen concepten (concept + label) voor de sjabloon-zin. Een stap
 * waarvan het symbool intussen verwijderd is, houdt zijn concept (label = concept als terugval), zodat
 * de zin binnen de gekozen concepten blijft (DESIGN §7.8).
 */
async function buildMessageInput(
  prisma: PrismaClient,
  steps: ConversationStepModel[],
): Promise<{ symbols: ReturnType<typeof symbolToPublic>[]; chosen: ChosenConcept[] }> {
  const ids = steps.map((step) => step.selectedSymbolId).filter((id): id is string => id !== null);
  const models =
    ids.length > 0 ? await prisma.aacSymbol.findMany({ where: { id: { in: ids } } }) : [];
  const byId = new Map<string, AacSymbolModel>(models.map((symbol) => [symbol.id, symbol]));

  const symbols: ReturnType<typeof symbolToPublic>[] = [];
  const chosen: ChosenConcept[] = [];
  for (const step of steps) {
    const model = step.selectedSymbolId ? byId.get(step.selectedSymbolId) : undefined;
    if (model) symbols.push(symbolToPublic(model));
    chosen.push({ concept: step.selectedConcept, label: model?.label ?? step.selectedConcept });
  }
  return { symbols, chosen };
}

/** Bouwt de volledige gesprekstoestand (huidige vraag + historie) voor `start`/`next`/`back`. */
async function buildState(
  prisma: PrismaClient,
  session: ConversationSessionModel,
  steps: ConversationStepModel[],
): Promise<ConversationStateResponse> {
  const [question, history] = await Promise.all([
    currentQuestion(prisma, steps),
    buildHistory(prisma, steps),
  ]);
  return conversationStateResponseSchema.parse({
    sessionId: session.id,
    status: session.status,
    question,
    done: question === null,
    history,
  });
}

/**
 * Gespreksflow: sessies en stappen (T4.1, DESIGN §3.1, §6.2, §8.2, FR-001/005/006/010).
 *
 * Alle routes lopen op **apparaat-auth** (`deviceAuthorize`): de tablet start het gesprek en is aan
 * precies één gebruiker gebonden, zodat elke sessie automatisch gebruiker-gebonden en -geïsoleerd is
 * (een apparaat ziet nooit de sessies van een andere gebruiker → `404`). De vraagselectie draait in
 * deze fase op de gescripte engine over de AAC-relatieboom; de AI-orchestrator neemt die rol later
 * over achter dezelfde interface (fase 5).
 *
 * - `POST /conversation/start` — nieuwe sessie; eerste vraag (intentie-categorieën) terug.
 * - `POST /conversation/{id}/next` — **kern-call:** keuze insturen → volgende vraag + opties terug.
 * - `POST /conversation/{id}/choice` — keuze alléén opslaan (save-only primitive; geen volgende vraag).
 * - `POST /conversation/{id}/back` — laatste keuze ongedaan maken; vorige vraag/opties exact hersteld.
 * - `POST /conversation/{id}/generate` — boodschap voorstellen (sjabloon-zin + confidence; T4.3, vluchtig).
 * - `POST /conversation/{id}/confirm` — bevestigen → sessie afronden en de boodschap opslaan (T4.3).
 */
export function registerConversationRoutes(
  app: FastifyInstance,
  { prisma }: ConversationRoutesDeps,
): void {
  // Sessie starten — apparaat-auth. Maakt een ACTIVE sessie voor de eigen gebruiker en geeft de
  // startvraag terug (nog geen stappen).
  app.post(
    '/conversation/start',
    { preHandler: deviceAuthorize(prisma) },
    async (request, reply): Promise<ConversationStateResponse> => {
      const device = requireDevice(request);
      const session = await prisma.conversationSession.create({
        data: { userId: device.userId, status: 'ACTIVE' },
      });
      reply.status(201);
      return buildState(prisma, session, []);
    },
  );

  // Keuze insturen → volgende vraag. De keuze moet één van de huidige opties zijn (anders 400).
  app.post(
    '/conversation/:id/next',
    { preHandler: deviceAuthorize(prisma) },
    async (request): Promise<ConversationStateResponse> => {
      const device = requireDevice(request);
      const { id } = sessionParamsSchema.parse(request.params);
      const { symbolId } = conversationChoiceRequestSchema.parse(request.body);

      const session = await loadOwnedSession(prisma, device.userId, id);
      if (session.status !== 'ACTIVE') {
        throw new HttpError(409, 'SESSION_NOT_ACTIVE', 'Dit gesprek is al afgerond.');
      }

      const steps = await loadSteps(prisma, session.id);
      const resolved = await resolveOption(prisma, steps, symbolId);
      if (!resolved) {
        throw new HttpError(400, 'INVALID_CHOICE', 'Deze keuze hoort niet bij de huidige vraag.');
      }

      await prisma.conversationStep.create({
        data: {
          sessionId: session.id,
          order: steps.length,
          question: resolved.question,
          selectedConcept: resolved.symbol.concept,
          selectedSymbolId: resolved.symbol.id,
          confidence: null,
        },
      });

      return buildState(prisma, session, await loadSteps(prisma, session.id));
    },
  );

  // Keuze alléén opslaan (save-only). Geeft de opgeslagen stap terug + of er nog verfijning mogelijk
  // is; niet de volgende vraag (dat doet /next). Een normale beurt gebruikt /next.
  app.post(
    '/conversation/:id/choice',
    { preHandler: deviceAuthorize(prisma) },
    async (request, reply): Promise<ConversationChoiceResponse> => {
      const device = requireDevice(request);
      const { id } = sessionParamsSchema.parse(request.params);
      const { symbolId } = conversationChoiceRequestSchema.parse(request.body);

      const session = await loadOwnedSession(prisma, device.userId, id);
      if (session.status !== 'ACTIVE') {
        throw new HttpError(409, 'SESSION_NOT_ACTIVE', 'Dit gesprek is al afgerond.');
      }

      const steps = await loadSteps(prisma, session.id);
      const resolved = await resolveOption(prisma, steps, symbolId);
      if (!resolved) {
        throw new HttpError(400, 'INVALID_CHOICE', 'Deze keuze hoort niet bij de huidige vraag.');
      }

      const created = await prisma.conversationStep.create({
        data: {
          sessionId: session.id,
          order: steps.length,
          question: resolved.question,
          selectedConcept: resolved.symbol.concept,
          selectedSymbolId: resolved.symbol.id,
          confidence: null,
        },
      });

      const newSteps = await loadSteps(prisma, session.id);
      const nextQuestion = await currentQuestion(prisma, newSteps);
      reply.status(201);
      return conversationChoiceResponseSchema.parse({
        sessionId: session.id,
        status: session.status,
        step: {
          order: created.order,
          question: created.question,
          symbol: resolved.symbol,
        },
        canRefine: nextQuestion !== null,
        history: await buildHistory(prisma, newSteps),
      });
    },
  );

  // Laatste keuze ongedaan maken — herstelt de vorige vraag/opties exact (pure functie van de stappen).
  app.post(
    '/conversation/:id/back',
    { preHandler: deviceAuthorize(prisma) },
    async (request): Promise<ConversationStateResponse> => {
      const device = requireDevice(request);
      const { id } = sessionParamsSchema.parse(request.params);

      const session = await loadOwnedSession(prisma, device.userId, id);
      const steps = await loadSteps(prisma, session.id);
      if (steps.length === 0) {
        throw new HttpError(400, 'NO_STEPS_TO_UNDO', 'Er is geen keuze om ongedaan te maken.');
      }

      const last = steps[steps.length - 1]!;
      await prisma.conversationStep.delete({ where: { id: last.id } });

      return buildState(prisma, session, await loadSteps(prisma, session.id));
    },
  );

  // Boodschap voorstellen (T4.3) — sjabloon-gebaseerde zin uit de gekozen concepten, met confidence en
  // de pictogramreeks voor het voorstelscherm. Bewust **vluchtig**: er wordt niets opgeslagen (DESIGN
  // §3.6, geen afgewezen voorstellen in de db). De zin is een pure functie van de opgeslagen keuzes.
  app.post(
    '/conversation/:id/generate',
    { preHandler: deviceAuthorize(prisma) },
    async (request): Promise<ConversationGenerateResponse> => {
      const device = requireDevice(request);
      const { id } = sessionParamsSchema.parse(request.params);

      const session = await loadOwnedSession(prisma, device.userId, id);
      if (session.status !== 'ACTIVE') {
        throw new HttpError(409, 'SESSION_NOT_ACTIVE', 'Dit gesprek is al afgerond.');
      }

      const steps = await loadSteps(prisma, session.id);
      if (steps.length === 0) {
        throw new HttpError(400, 'NO_STEPS_TO_GENERATE', 'Maak eerst een keuze.');
      }

      const { symbols, chosen } = await buildMessageInput(prisma, steps);
      return conversationGenerateResponseSchema.parse({
        sessionId: session.id,
        status: session.status,
        message: generateMessage(chosen),
        confidence: SCRIPTED_CONFIDENCE,
        symbols,
        history: await buildHistory(prisma, steps),
      });
    },
  );

  // Boodschap bevestigen (T4.3) — rondt de sessie af en slaat de boodschap op. De server hergenereert
  // de zin deterministisch uit de opgeslagen keuzes (nooit vrije clienttekst), zodat de bewaarde
  // boodschap binnen de gekozen concepten blijft (DESIGN §7.8). Alleen **bevestigde** communicatie
  // wordt bewaard (DESIGN §3.6). Een afwijzing verloopt via `/back`, niet hier.
  app.post(
    '/conversation/:id/confirm',
    { preHandler: deviceAuthorize(prisma) },
    async (request): Promise<ConversationConfirmResponse> => {
      const device = requireDevice(request);
      const { id } = sessionParamsSchema.parse(request.params);

      const session = await loadOwnedSession(prisma, device.userId, id);
      if (session.status !== 'ACTIVE') {
        throw new HttpError(409, 'SESSION_NOT_ACTIVE', 'Dit gesprek is al afgerond.');
      }

      const steps = await loadSteps(prisma, session.id);
      if (steps.length === 0) {
        throw new HttpError(400, 'NO_STEPS_TO_GENERATE', 'Maak eerst een keuze.');
      }

      const { chosen } = await buildMessageInput(prisma, steps);
      const message = generateMessage(chosen);

      // Bevestigde boodschap opslaan én de sessie afronden in één transactie.
      await prisma.$transaction([
        prisma.generatedMessage.create({
          data: { sessionId: session.id, message, confirmed: true },
        }),
        prisma.conversationSession.update({
          where: { id: session.id },
          data: { status: 'COMPLETED' },
        }),
      ]);

      return conversationConfirmResponseSchema.parse({
        sessionId: session.id,
        status: 'COMPLETED',
        message,
      });
    },
  );
}
