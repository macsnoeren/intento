import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  conversationChoiceRequestSchema,
  conversationChoiceResponseSchema,
  conversationConfirmResponseSchema,
  conversationCorrectionRequestSchema,
  conversationGenerateResponseSchema,
  conversationStateResponseSchema,
  pendingQuestionResponseSchema,
  type ConversationChoiceResponse,
  type ConversationConfirmResponse,
  type ConversationGenerateResponse,
  type AacSymbol as AacSymbolPublic,
  type ConversationStateResponse,
  type PendingQuestionResponse,
} from '@intento/shared';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type {
  AacSymbolModel,
  ConversationSessionModel,
  ConversationStepModel,
} from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { deviceAuthorize, requireDevice } from '../auth/device.js';
import { forbidAccountSession } from '../auth/authorize.js';
import { loadChildSymbols, serializeHistory } from '../conversation/engine.js';
import { decideNextQuestion, type DecisionRejection } from '../conversation/decision.js';
import { analyzeCorrection } from '../conversation/correction.js';
import { readOfferedConcepts, readPendingOffer, type PendingOffer } from '../conversation/offer.js';
import { readHypothesis } from '../conversation/hypothesis.js';
import { composeMessage } from '../conversation/generate.js';
import { defaultStrategy } from '../conversation/strategy.js';
import type { AiOrchestrator } from '../ai/orchestrator.js';
import { DEFAULT_INTERPRETATION_CONFIDENCE, phaseForDecision } from '../ai/thresholds.js';
import type { ChosenConcept } from '../conversation/message.js';
import { symbolToPublic } from '../aac/library.js';
import type { Encryptor } from '../crypto/encryption.js';
import type { Env } from '../env.js';
import type { OpenSymbolsClient } from '../aac/opensymbols.js';
import { loadAllowedUserContext } from '../users/personal-context.js';
import { learnFromConfirmedConcepts, loadPreferenceContext } from '../users/preferences.js';
import type { AiUserContextItem } from '../ai/provider.js';

export interface ConversationRoutesDeps {
  prisma: PrismaClient;
  /** AI-orchestrator die de volgende vraag kiest (mock in tests, echte provider via env — T5.2). */
  orchestrator: AiOrchestrator;
  /** Veldversleuteling (T6.1): ontsleutelt de toegestane persoonlijke context voor het AI-contextobject. */
  encryptor: Encryptor;
  /** Env voor het kandidaten-/conceptbeleid (T10.2/T10.6: `AI_MAX_CANDIDATES`, `AI_ALLOW_NEW_CONCEPTS`). */
  env: Env;
  /** Pictogrambron voor een nieuw, door de AI aangedragen concept (T10.6); mag uitgeschakeld zijn. */
  openSymbols?: OpenSymbolsClient;
}

/** Route-parameter: het sessie-id uit het pad. */
const sessionParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Aantal begin-stappen dat **niet** van de gebruiker komt (T9.14). In vraagmodus (T7.1) zet de begeleider
 * het topic-anker als stap 0; die stap is geen keuze van de gebruiker. Alleen op basis daarvan mag er dus
 * nooit een boodschap voorgesteld of teruggerold worden — de betekenis blijft van de gebruiker (DESIGN §2).
 */
function anchoredStepsFor(session: Pick<ConversationSessionModel, 'mode'>): number {
  return session.mode === 'question' ? 1 : 0;
}

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

/**
 * De volledige **toegestane** AI-gebruikerscontext (DESIGN §7.3, §7.7): de persoonlijke context met
 * toestemming (T6.1, `aiUsageAllowed=true`) plus de geleerde voorkeuren (T6.3, alléén als de gebruiker
 * leren heeft aanstaan). Beide filters zitten in hun eigen loader, zodat context zonder toestemming en
 * voorkeuren bij uitgeschakeld leren de prompt nooit bereiken.
 */
async function loadUserContext(
  prisma: PrismaClient,
  encryptor: Encryptor,
  userId: string,
): Promise<AiUserContextItem[]> {
  const [personal, preferences] = await Promise.all([
    loadAllowedUserContext(prisma, encryptor, userId),
    loadPreferenceContext(prisma, userId),
  ]);
  return [...personal, ...preferences];
}

/**
 * De in deze sessie **afgewezen** concepten met het soort afwijzing (uit eerdere correcties, T5.4/T10.4).
 * Deze worden bij elke volgende beslissing uitgesloten van de aangeboden opties én **meegegeven aan de
 * AI**, zodat een afgewezen route nooit opnieuw wordt aangeboden én het model zijn richting kan verleggen
 * (DESIGN §3.4, §7.5). Puur afgeleid uit de opgeslagen `CorrectionEvent`s, zodat de uitsluiting blijft
 * gelden voor de rest van de sessie (ook na `/back` of `/next`). Bij een dubbel voorkomend concept wint
 * `no_fitting_option`: dat is het sterkste signaal ("zoek in een andere richting").
 */
async function loadRejections(
  prisma: PrismaClient,
  sessionId: string,
): Promise<DecisionRejection[]> {
  const events = await prisma.correctionEvent.findMany({
    where: { sessionId },
    select: { rejectedConcept: true, type: true },
  });
  const byConcept = new Map<string, DecisionRejection>();
  for (const event of events) {
    const kind = event.type === 'no_fitting_option' ? 'no_fitting_option' : 'wrong_guess';
    const existing = byConcept.get(event.rejectedConcept);
    if (existing && existing.kind === 'no_fitting_option') continue;
    byConcept.set(event.rejectedConcept, { concept: event.rejectedConcept, kind });
  }
  return [...byConcept.values()];
}

/**
 * Maakt het openstaande aanbod leeg, zodat de volgende `ensureOffer` een verse beslissing neemt. Nodig
 * na elke gebeurtenis die de stand verandert: een keuze, een correctie of een afwijzing van het aanbod.
 */
async function clearPendingOffer(
  prisma: PrismaClient,
  session: ConversationSessionModel,
): Promise<void> {
  await prisma.conversationSession.update({
    where: { id: session.id },
    // `Prisma.DbNull` is de expliciete database-NULL voor een nullable Json-kolom (een gewone `null`
    // zou de JSON-waarde `null` betekenen — een ander ding).
    data: { pendingOffer: Prisma.DbNull },
  });
  session.pendingOffer = null;
}

/**
 * De eerder in deze sessie **gestelde vragen** (T10.4, DESIGN §7.5). Reizen mee naar de AI zodat die niet
 * dezelfde vraag in andere bewoordingen herhaalt. Bewust alleen door het systeem geformuleerde vragen —
 * geen gebruikersinvoer, dus geen chatgeschiedenis.
 */
function askedQuestionsFrom(
  steps: ConversationStepModel[],
  pending: PendingOffer | null,
): string[] {
  const questions = steps.map((step) => step.question);
  if (pending) questions.push(pending.question);
  return [...new Set(questions.filter((question) => question.length > 0))];
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
    // De categorie reist mee zodat de zinsgenerator weet of de route met een **intentie** begint (T10.9);
    // sinds de AI ook op het startscherm een concept mag aandragen is dat niet meer vanzelfsprekend.
    chosen.push({
      concept: step.selectedConcept,
      label: model?.label ?? step.selectedConcept,
      ...(model ? { category: model.category } : {}),
    });
  }
  return { symbols, chosen };
}

/** De context die elke beslissing/aanbod-berekening nodig heeft; één plek zodat de routes smal blijven. */
interface DecisionDeps {
  prisma: PrismaClient;
  orchestrator: AiOrchestrator;
  encryptor: Encryptor;
  env: Env;
  openSymbols?: OpenSymbolsClient;
}

/**
 * Zorgt dat er een **geldig, vastgelegd vraagaanbod** is voor de huidige stand van het gesprek (T10.3).
 *
 * Hoort het bewaarde aanbod bij het huidige aantal stappen, dan wordt dat teruggegeven — zonder
 * AI-aanroep. Zo niet, dan neemt de beslissingslaag een nieuwe beslissing en wordt die op de sessie
 * vastgelegd. Dat is sinds Fase 10 nodig omdat de beslissing géén pure functie van de stappen meer is:
 * de kandidaten komen uit retrieval en de AI kiest daarbinnen, dus een tweede aanroep kan andere opties
 * geven. Zonder vastlegging zou `↩ Terug` een ánder scherm tonen dan de gebruiker net zag, en zou een
 * geldige keuze als `INVALID_CHOICE` geweigerd kunnen worden.
 *
 * Geeft `null` terug als er geen vraag meer is (de fase is `propose`: klaar om een boodschap voor te
 * stellen). Ook dán wordt de uitkomst vastgelegd, zodat het voorstelscherm niet per verversing opnieuw
 * de AI aanroept.
 */
async function ensureOffer(
  deps: DecisionDeps,
  session: ConversationSessionModel,
  steps: ConversationStepModel[],
  log?: FastifyBaseLogger,
): Promise<{ offer: PendingOffer | null; done: boolean; confidence: number; phase: string }> {
  const { prisma, orchestrator, encryptor, env } = deps;

  const stored = readPendingOffer(session.pendingOffer, steps.length);
  if (stored) {
    return {
      offer: stored,
      done: false,
      confidence: stored.confidence,
      phase: stored.phase,
    };
  }

  // In deze sessie afgewezen concepten (T5.4) blijven uitgesloten — nooit dezelfde foutieve route (§7.5) —
  // en reizen als **signaal** mee naar de AI (T10.4). De toegestane persoonlijke context (T6.1) gaat
  // alleen mee met toestemming (§6.3).
  const [rejections, userContext] = await Promise.all([
    loadRejections(prisma, session.id),
    loadUserContext(prisma, encryptor, session.userId),
  ]);

  const decision = await decideNextQuestion(prisma, orchestrator, {
    steps,
    rejections,
    askedQuestions: askedQuestionsFrom(steps, null),
    userContext,
    // Bij een vraagmodus-sessie (T7.1) reist de begeleidersvraag als context mee naar de AI, zodat de
    // antwoorden op die vraag worden afgestemd.
    questionContext: session.caregiverQuestion,
    anchoredSteps: anchoredStepsFor(session),
    userId: session.userId,
    // De aanpak van dit gesprek (T11.2, DESIGN §7.10). De env-grenzen blijven er als plafond overheen
    // gaan: een strategie kan ze aanscherpen, nooit oprekken.
    strategy: defaultStrategy(),
    maxCandidates: env.AI_MAX_CANDIDATES,
    allowNewConcepts: env.AI_ALLOW_NEW_CONCEPTS,
    icons: deps.openSymbols ?? null,
    hypothesis: readHypothesis(session.hypothesis),
  });

  // Zichtbaar maken wát de AI deed (T9.15): taak, hoeveel kandidaten er waren (en waar ze vandaan
  // kwamen), hoeveel opties de AI zelf aandroeg, wat er uiteindelijk wordt aangeboden en waarom. Bewust
  // alléén AAC-concepten en tellingen — geen persoonlijke context, geen boodschapinhoud (DESIGN §9.4).
  log?.info(
    {
      ai: {
        provider: orchestrator.providerName,
        sessionId: session.id,
        step: steps.length,
        candidates: decision.diagnostics.candidateCount,
        candidateSources: decision.diagnostics.candidateSources,
        aiOptions: decision.diagnostics.aiOptionCount,
        offered: decision.diagnostics.offered,
        widened: decision.diagnostics.widened,
        confidence: decision.confidence,
        phase: decision.phase,
        done: decision.done,
        reason: decision.diagnostics.reason,
        proposedUnknown: decision.proposed,
        createdConcepts: decision.created,
        rejected: rejections.map((rejection) => `${rejection.concept}:${rejection.kind}`),
      },
    },
    'AI-beslissing voor de volgende vraag',
  );

  const offer: PendingOffer | null = decision.question
    ? {
        stepCount: steps.length,
        question: decision.question.prompt,
        concepts: decision.question.options.map((option) => option.concept),
        confidence: decision.confidence,
        phase: decision.phase,
      }
    : null;

  await prisma.conversationSession.update({
    where: { id: session.id },
    data: {
      pendingOffer: offer ?? Prisma.DbNull,
      // De hypothese leeft door over de beurten heen (T10.8); niet aanraken als er geen AI aan te pas kwam.
      ...(decision.hypothesis ? { hypothesis: decision.hypothesis } : {}),
    },
  });
  session.pendingOffer = offer;

  return {
    offer,
    done: decision.done,
    confidence: decision.confidence,
    phase: decision.phase,
  };
}

/**
 * Bouwt de volledige gesprekstoestand (vraag + historie) voor `start`/`next`/`back`/`correction`. De
 * vraag komt uit het vastgelegde aanbod (`ensureOffer`), dat op zijn beurt uit de AI-beslissingslaag
 * komt: gevalideerd, herhaling-vrij en op zekerheid geordend. `confidence`/`phase` reizen mee (§7.4).
 */
async function buildState(
  deps: DecisionDeps,
  session: ConversationSessionModel,
  steps: ConversationStepModel[],
  log?: FastifyBaseLogger,
): Promise<ConversationStateResponse> {
  const [{ offer, done, confidence, phase }, history] = await Promise.all([
    ensureOffer(deps, session, steps, log),
    buildHistory(deps.prisma, steps),
  ]);

  const question = offer ? await questionFromOffer(deps.prisma, offer) : null;

  return conversationStateResponseSchema.parse({
    sessionId: session.id,
    status: session.status,
    question,
    done: question === null && done,
    confidence,
    phase,
    history,
    // Bij vraagmodus toont de gebruikersapp de begeleidersvraag als context; `null` bij een vrij gesprek.
    caregiverQuestion: session.caregiverQuestion,
  });
}

/**
 * Zet een vastgelegd aanbod om naar de te tonen vraag: de symbolen worden vers uit de bibliotheek
 * geladen (zodat een intussen bijgewerkt label/pictogram meteen klopt) maar de **volgorde en samenstelling
 * komen uit het aanbod**. Een concept dat intussen verwijderd is, valt weg; blijft er niets over, dan is
 * er geen vraag meer.
 */
async function questionFromOffer(
  prisma: PrismaClient,
  offer: PendingOffer,
): Promise<ConversationStateResponse['question']> {
  if (offer.concepts.length === 0) return null;
  const symbols = await prisma.aacSymbol.findMany({ where: { concept: { in: offer.concepts } } });
  const byConcept = new Map<string, AacSymbolModel>(symbols.map((s) => [s.concept, s]));
  const options = offer.concepts
    .map((concept) => byConcept.get(concept))
    .filter((symbol): symbol is AacSymbolModel => symbol !== undefined)
    .map(symbolToPublic);
  return options.length > 0 ? { prompt: offer.question, options } : null;
}

/**
 * Valideert dat `symbolId` één van de **daadwerkelijk aangeboden** opties is en geeft het gekozen symbool
 * + de bijbehorende vraag terug (T10.3). Vóór Fase 10 liep deze controle tegen de AAC-boom; sinds de
 * kandidaten uit retrieval komen zou dat elke geldige keuze buiten de boom weigeren. `null` betekent:
 * geen geldige keuze (onbekend id, of niet aangeboden, of er staat geen vraag open).
 */
async function resolveOfferedOption(
  prisma: PrismaClient,
  offer: PendingOffer | null,
  symbolId: string,
): Promise<{ symbol: AacSymbolPublic; question: string } | null> {
  if (!offer) return null;
  const symbol = await prisma.aacSymbol.findUnique({ where: { id: symbolId } });
  if (!symbol || !offer.concepts.includes(symbol.concept)) return null;
  return { symbol: symbolToPublic(symbol), question: offer.question };
}

/**
 * Gespreksflow: sessies en stappen (T4.1, DESIGN §3.1, §6.2, §8.2, FR-001/005/006/010).
 *
 * Alle routes lopen op **apparaat-auth** (`deviceAuthorize`): de tablet start het gesprek en is aan
 * precies één gebruiker gebonden, zodat elke sessie automatisch gebruiker-gebonden en -geïsoleerd is
 * (een apparaat ziet nooit de sessies van een andere gebruiker → `404`). De vraagselectie draait vanaf
 * T5.2 op de **AI-orchestrator** (`decideNextQuestion`): de AAC-relatieboom levert de begrensde
 * kandidaten, de AI kiest/ordent daarbinnen, de validatielaag houdt onbekende concepten tegen en de
 * confidence bepaalt de fase (§7.4). In tests draait de deterministische mock-provider.
 *
 * - `POST /conversation/start` — nieuwe sessie; eerste vraag (intentie-categorieën) terug.
 * - `POST /conversation/{id}/next` — **kern-call:** keuze insturen → volgende vraag + opties terug.
 * - `POST /conversation/{id}/choice` — keuze alléén opslaan (save-only primitive; geen volgende vraag).
 * - `POST /conversation/{id}/back` — laatste keuze ongedaan maken; vorige vraag/opties exact hersteld.
 * - `POST /conversation/{id}/correction` — ❌ op een voorstel: heranalyse → gerichtere hervraag (T5.4).
 * - `POST /conversation/{id}/generate` — boodschap voorstellen (sjabloon-zin + confidence; T4.3, vluchtig).
 * - `POST /conversation/{id}/confirm` — bevestigen → sessie afronden en de boodschap opslaan (T4.3).
 */
export function registerConversationRoutes(
  app: FastifyInstance,
  { prisma, orchestrator, encryptor, env, openSymbols }: ConversationRoutesDeps,
): void {
  const deps: DecisionDeps = { prisma, orchestrator, encryptor, env, openSymbols };

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
      return buildState(deps, session, [], request.log);
    },
  );

  // Openstaande begeleidersvraag ophalen (vraagmodus, T7.1, DESIGN §3.2). De tablet checkt dit bij het
  // openen (en na "opnieuw beginnen"): staat er een ACTIVE vraagmodus-sessie voor de eigen gebruiker
  // klaar, dan pakt de app die op (de vraag "verschijnt in de gebruikersapp"); anders `null` → vrij
  // gesprek. De nieuwste openstaande vraag wint. Gebruiker-geïsoleerd via device-auth (alleen de eigen
  // gebruiker); de begeleider zette de sessie klaar via `POST /question/start`.
  app.get(
    '/conversation/pending',
    { preHandler: deviceAuthorize(prisma) },
    async (request): Promise<PendingQuestionResponse> => {
      const device = requireDevice(request);
      const session = await prisma.conversationSession.findFirst({
        where: { userId: device.userId, mode: 'question', status: 'ACTIVE' },
        orderBy: { startedAt: 'desc' },
      });
      if (!session) {
        return pendingQuestionResponseSchema.parse({ state: null });
      }
      const state = await buildState(
        deps,
        session,
        await loadSteps(prisma, session.id),
        request.log,
      );
      return pendingQuestionResponseSchema.parse({ state });
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
      // Het openstaande aanbod bepaalt wat een geldige keuze is (T10.3); staat er nog geen aanbod, dan
      // wordt het hier alsnog berekend en vastgelegd.
      const { offer } = await ensureOffer(deps, session, steps, request.log);
      const resolved = await resolveOfferedOption(prisma, offer, symbolId);
      if (!resolved) {
        throw new HttpError(400, 'INVALID_CHOICE', 'Deze keuze hoort niet bij de huidige vraag.');
      }

      // De stap legt vast wélke opties er bij deze vraag zijn aangeboden en met welke zekerheid, zodat
      // `↩ Terug` exact herstelt en "Geen van deze past" precies uitsluit wat de gebruiker gezien heeft.
      await prisma.conversationStep.create({
        data: {
          sessionId: session.id,
          order: steps.length,
          question: resolved.question,
          selectedConcept: resolved.symbol.concept,
          selectedSymbolId: resolved.symbol.id,
          confidence: offer?.confidence ?? null,
          offeredConcepts: offer?.concepts ?? [],
        },
      });
      // Het aanbod is beantwoord: weg ermee, zodat er een nieuwe beslissing volgt.
      await clearPendingOffer(prisma, session);

      return buildState(deps, session, await loadSteps(prisma, session.id), request.log);
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
      const { offer } = await ensureOffer(deps, session, steps, request.log);
      const resolved = await resolveOfferedOption(prisma, offer, symbolId);
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
          confidence: offer?.confidence ?? null,
          offeredConcepts: offer?.concepts ?? [],
        },
      });
      await clearPendingOffer(prisma, session);

      const newSteps = await loadSteps(prisma, session.id);
      reply.status(201);
      return conversationChoiceResponseSchema.parse({
        sessionId: session.id,
        status: session.status,
        step: {
          order: created.order,
          question: created.question,
          symbol: resolved.symbol,
        },
        // Save-only: geen nieuwe AI-beslissing forceren. Of er nog te verfijnen valt, leiden we af uit
        // de bibliotheek — het laatst gekozen concept is een eindconcept of niet (§7.4).
        canRefine: (await loadChildSymbols(prisma, resolved.symbol.concept)).length > 0,
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
      // Vraagmodus (T7.1): de eerste stap is het door de begeleider gekozen topic-anker; dat mag de
      // gebruiker niet ongedaan maken (anders ontsnapt het gesprek uit de vraag naar het vrije
      // startscherm). Terug blijft wél mogelijk zolang er nog een eigen keuze bovenop het anker staat.
      if (session.mode === 'question' && steps.length === 1) {
        throw new HttpError(400, 'NO_STEPS_TO_UNDO', 'Er is geen keuze om ongedaan te maken.');
      }

      const last = steps[steps.length - 1]!;
      await prisma.conversationStep.delete({ where: { id: last.id } });

      // Terug herstelt de vorige vraag **exact** (T4.1/T10.3): het aanbod komt uit wat er destijds bij
      // die stap is aangeboden, niet uit een nieuwe AI-beslissing die andere opties zou kunnen kiezen.
      const restored: PendingOffer = {
        stepCount: steps.length - 1,
        question: last.question,
        concepts: readOfferedConcepts(last.offeredConcepts),
        confidence: last.confidence ?? DEFAULT_INTERPRETATION_CONFIDENCE,
        phase: phaseForDecision(last.confidence ?? DEFAULT_INTERPRETATION_CONFIDENCE, false),
      };
      // Stappen van vóór T10.3 hebben geen vastgelegd aanbod; dan valt de laag terug op een nieuwe
      // beslissing (`ensureOffer` ziet een leeg aanbod als afwezig).
      const pendingOffer = restored.concepts.length > 0 ? restored : null;
      await prisma.conversationSession.update({
        where: { id: session.id },
        data: { pendingOffer: pendingOffer ?? Prisma.DbNull },
      });
      session.pendingOffer = pendingOffer;

      return buildState(deps, session, await loadSteps(prisma, session.id), request.log);
    },
  );

  // Correctie (T5.4/T9.12, DESIGN §3.4, FR-009). Twee soorten "dit klopt niet":
  //
  // - `wrong_guess` (❌ op een **voorstel**): gaat **niet** terug naar het begin. De heranalyse
  //   (`analyzeCorrection`) bepaalt uit de per-stap-zekerheid (§7.4) de vermoedelijke foutstap, die stap
  //   en alles erna worden teruggerold, en het afgewezen concept wordt als `CorrectionEvent` vastgelegd
  //   zodat het de rest van de sessie niet meer wordt aangeboden (§7.5, via `buildState`). Het
  //   begeleiders-anker van een vraagmodus-sessie blijft daarbij staan (T9.14).
  // - `no_fitting_option` (T9.12, "Geen van deze past"): het juiste pictogram staat niet tussen de
  //   aangeboden opties. Er wordt **niets teruggerold** — de gemaakte keuzes blijven staan — maar alle
  //   concepten van dit punt worden uitgesloten, waarna de beslissingslaag een niveau hoger verdergaat.
  //   Zo heeft de gebruiker altijd een uitweg als de bibliotheek zijn woord hier niet heeft.
  //
  // De correctie is een **signaal**, geen leerdata: er worden geen voorkeuren gemuteerd (§3.4 punt 4).
  app.post(
    '/conversation/:id/correction',
    { preHandler: deviceAuthorize(prisma) },
    async (request): Promise<ConversationStateResponse> => {
      const device = requireDevice(request);
      const { id } = sessionParamsSchema.parse(request.params);
      // De body wordt gevalideerd (`wrong_guess` of `no_fitting_option`); een lege body volstaat.
      const { type } = conversationCorrectionRequestSchema.parse(request.body ?? {});

      const session = await loadOwnedSession(prisma, device.userId, id);
      if (session.status !== 'ACTIVE') {
        throw new HttpError(409, 'SESSION_NOT_ACTIVE', 'Dit gesprek is al afgerond.');
      }

      const steps = await loadSteps(prisma, session.id);

      if (type === 'no_fitting_option') {
        // Precies de concepten uitsluiten die de gebruiker **gezien** heeft (T10.3/T10.5): die staan in
        // het vastgelegde aanbod. We geloven de client niet — het aanbod is server-side vastgelegd, dus
        // een client kan nooit iets uitsluiten dat hier niet is aangeboden.
        const { offer } = await ensureOffer(deps, session, steps, request.log);
        if (!offer || offer.concepts.length === 0) {
          throw new HttpError(
            400,
            'NO_OPTIONS_TO_SKIP',
            'Er zijn hier geen andere opties om over te slaan.',
          );
        }
        await prisma.correctionEvent.createMany({
          data: offer.concepts.map((concept) => ({
            sessionId: session.id,
            type,
            stepOrder: steps.length,
            rejectedConcept: concept,
          })),
        });
        // Geen stappen teruggerold: de keuzes van de gebruiker blijven staan. Het aanbod vervalt, zodat
        // de beslissingslaag een **nieuwe retrieval-ronde** doet met de afwijzing als signaal (T10.5) —
        // een andere invalshoek dus, en géén terugval naar het startscherm.
        await clearPendingOffer(prisma, session);
        return buildState(deps, session, steps, request.log);
      }

      if (steps.length === 0) {
        throw new HttpError(400, 'NO_STEPS_TO_CORRECT', 'Er is nog geen keuze om te corrigeren.');
      }
      // In vraagmodus mag de ankerstap van de begeleider niet teruggerold worden; is er verder niets
      // gekozen, dan valt er niets te corrigeren.
      const anchored = anchoredStepsFor(session);
      if (steps.length <= anchored) {
        throw new HttpError(400, 'NO_STEPS_TO_CORRECT', 'Er is nog geen keuze om te corrigeren.');
      }

      // De hypothese wijst het **kantelpunt** aan (T10.8): de stap waar de zekerheid het sterkst daalde.
      // Zonder hypothese valt de analyse terug op de laagste per-stap-zekerheid (T5.4).
      const { stepOrder, rejectedConcept } = analyzeCorrection(
        steps,
        anchored,
        readHypothesis(session.hypothesis),
      );

      // Foutstap + alles erna terugrollen en de correctie vastleggen — in één transactie zodat de
      // uitsluiting en de teruggerolde stappen altijd consistent zijn.
      await prisma.$transaction([
        prisma.correctionEvent.create({
          data: { sessionId: session.id, type, stepOrder, rejectedConcept },
        }),
        prisma.conversationStep.deleteMany({
          where: { sessionId: session.id, order: { gte: stepOrder } },
        }),
      ]);

      // Gerichtere hervraag op het teruggerolde punt; het afgewezen concept valt weg via `buildState`.
      await clearPendingOffer(prisma, session);
      return buildState(deps, session, await loadSteps(prisma, session.id), request.log);
    },
  );

  // Boodschap voorstellen (T5.3) — de AI-orchestrator formuleert een natuurlijke zin uit de gekozen
  // concepten (met confidence), begrensd door de safety-laag die geen concept buiten de sessie doorlaat
  // (§7.8); zonder AI-capability of bij een onveilige zin valt hij terug op de deterministische sjabloon.
  // Plus de pictogramreeks voor het voorstelscherm. Bewust **vluchtig**: er wordt niets opgeslagen (DESIGN
  // §3.6, geen afgewezen voorstellen in de db).
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
      const userContext = await loadUserContext(prisma, encryptor, session.userId);
      const composed = await composeMessage(prisma, orchestrator, chosen, userContext);
      return conversationGenerateResponseSchema.parse({
        sessionId: session.id,
        status: session.status,
        message: composed.message,
        confidence: composed.confidence,
        symbols,
        history: await buildHistory(prisma, steps),
      });
    },
  );

  // Boodschap bevestigen (T5.3) — rondt de sessie af en slaat de boodschap op. De server hervormt de
  // zin **server-side** uit de opgeslagen keuzes via de orchestrator (nooit vrije clienttekst), begrensd
  // door dezelfde safety-laag: de bewaarde boodschap blijft binnen de gekozen concepten (DESIGN §7.8) en
  // valt bij twijfel terug op de deterministische sjabloon. Alleen **bevestigde** communicatie wordt
  // bewaard (DESIGN §3.6). Een afwijzing verloopt via `/back`, niet hier.
  // Bevestigen is exclusief van de gebruiker (DESIGN §2, §3.3, FR-011): `forbidAccountSession` weigert
  // vóór de device-auth elke request die géén apparaat-token draagt maar wél een account-sessie, met 403 —
  // een boodschap kan zo nooit vanuit de begeleider-/beheer-UI bevestigd worden. Draagt de request wél een
  // geldig apparaat-token, dan komt hij van de gekoppelde tablet van de gebruiker en gaat hij door, ook als
  // er toevallig een beheerderscookie van dezelfde browser meereist (T9.5).
  app.post(
    '/conversation/:id/confirm',
    { preHandler: [forbidAccountSession(prisma), deviceAuthorize(prisma)] },
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
      const userContext = await loadUserContext(prisma, encryptor, session.userId);
      const { message } = await composeMessage(prisma, orchestrator, chosen, userContext);

      // Bevestigde boodschap opslaan én de sessie afronden in één transactie.
      await prisma.$transaction([
        prisma.generatedMessage.create({
          data: { sessionId: session.id, message, confirmed: true },
        }),
        prisma.conversationSession.update({
          where: { id: session.id },
          // De hypothese en het openstaande aanbod zijn **vluchtig** (T10.8, DESIGN §3.6): onzekere
          // aannames horen niet bewaard te blijven na afronding. Alleen de bevestigde boodschap en de
          // gelopen route blijven staan.
          data: {
            status: 'COMPLETED',
            hypothesis: Prisma.DbNull,
            pendingOffer: Prisma.DbNull,
          },
        }),
      ]);

      // Leren van deze **bevestigde** communicatie (T6.3, DESIGN §3.8, FR-014): de gekozen concepten
      // versterken de voorkeuren — maar alléén als de gebruiker leren heeft aanstaan (`aiLearningEnabled`).
      // Nooit van afwijzingen/correcties (die lopen via `/back`/`/correction` en raken deze laag niet).
      await learnFromConfirmedConcepts(
        prisma,
        session.userId,
        chosen.map((c) => c.concept),
      );

      return conversationConfirmResponseSchema.parse({
        sessionId: session.id,
        status: 'COMPLETED',
        message,
      });
    },
  );
}
