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
  type ConversationStateResponse,
  type PendingQuestionResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type {
  AacSymbolModel,
  ConversationSessionModel,
  ConversationStepModel,
} from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { deviceAuthorize, requireDevice } from '../auth/device.js';
import { forbidAccountSession } from '../auth/authorize.js';
import { currentQuestion, resolveOption, serializeHistory } from '../conversation/engine.js';
import { decideNextQuestion, findAvailableCandidates } from '../conversation/decision.js';
import { analyzeCorrection } from '../conversation/correction.js';
import { composeMessage } from '../conversation/generate.js';
import type { AiOrchestrator } from '../ai/orchestrator.js';
import type { ChosenConcept } from '../conversation/message.js';
import { symbolToPublic } from '../aac/library.js';
import type { Encryptor } from '../crypto/encryption.js';
import { loadAllowedUserContext } from '../users/personal-context.js';
import { learnFromConfirmedConcepts, loadPreferenceContext } from '../users/preferences.js';
import type { AiUserContextItem } from '../ai/provider.js';

export interface ConversationRoutesDeps {
  prisma: PrismaClient;
  /** AI-orchestrator die de volgende vraag kiest (mock in tests, echte provider via env — T5.2). */
  orchestrator: AiOrchestrator;
  /** Veldversleuteling (T6.1): ontsleutelt de toegestane persoonlijke context voor het AI-contextobject. */
  encryptor: Encryptor;
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
 * De in deze sessie **afgewezen** concepten (uit eerdere correcties, T5.4). Deze worden bij elke
 * volgende beslissing uitgesloten van de aangeboden opties, zodat een afgewezen route nooit opnieuw
 * wordt aangeboden (DESIGN §3.4, §7.5). Puur afgeleid uit de opgeslagen `CorrectionEvent`s, zodat de
 * uitsluiting blijft gelden voor de rest van de sessie (ook na `/back` of `/next`).
 */
async function loadRejectedConcepts(prisma: PrismaClient, sessionId: string): Promise<string[]> {
  const events = await prisma.correctionEvent.findMany({
    where: { sessionId },
    select: { rejectedConcept: true },
  });
  return events.map((event) => event.rejectedConcept);
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

/**
 * Bouwt de volledige gesprekstoestand (AI-gekozen vraag + historie) voor `start`/`next`/`back`. De
 * volgende vraag komt vanaf T5.2 uit de AI-beslissingslaag (`decideNextQuestion`): AAC-begrensd,
 * gevalideerd, herhaling-vrij en op zekerheid geordend. `confidence`/`phase` reizen mee (§7.4).
 */
async function buildState(
  prisma: PrismaClient,
  orchestrator: AiOrchestrator,
  encryptor: Encryptor,
  session: ConversationSessionModel,
  steps: ConversationStepModel[],
  log?: FastifyBaseLogger,
): Promise<ConversationStateResponse> {
  // In deze sessie afgewezen concepten (T5.4) blijven uitgesloten — nooit dezelfde foutieve route (§7.5).
  // De toegestane persoonlijke context (T6.1) reist mee naar de AI — alleen `aiUsageAllowed=true` (§6.3).
  const [excluded, userContext] = await Promise.all([
    loadRejectedConcepts(prisma, session.id),
    loadUserContext(prisma, encryptor, session.userId),
  ]);
  const [decision, history] = await Promise.all([
    // Bij een vraagmodus-sessie (T7.1) reist de begeleidersvraag als context mee naar de AI, zodat de
    // antwoorden op die vraag worden afgestemd (de opties blijven AAC-begrensd, §7.6).
    decideNextQuestion(
      prisma,
      orchestrator,
      steps,
      excluded,
      userContext,
      session.caregiverQuestion,
      anchoredStepsFor(session),
    ),
    buildHistory(prisma, steps),
  ]);

  // Zichtbaar maken wát de AI deed (T9.15): taak, hoeveel kandidaten er waren, hoeveel opties de AI zelf
  // aandroeg, wat er uiteindelijk wordt aangeboden en waarom. Bewust alléén AAC-concepten en tellingen —
  // geen persoonlijke context, geen boodschapinhoud (DESIGN §9.4).
  log?.info(
    {
      ai: {
        provider: orchestrator.providerName,
        sessionId: session.id,
        step: steps.length,
        candidates: decision.diagnostics.candidateCount,
        aiOptions: decision.diagnostics.aiOptionCount,
        offered: decision.diagnostics.offered,
        widened: decision.diagnostics.widened,
        confidence: decision.confidence,
        phase: decision.phase,
        done: decision.done,
        reason: decision.diagnostics.reason,
        proposedUnknown: decision.proposed,
      },
    },
    'AI-beslissing voor de volgende vraag',
  );

  return conversationStateResponseSchema.parse({
    sessionId: session.id,
    status: session.status,
    question: decision.question,
    done: decision.done,
    confidence: decision.confidence,
    phase: decision.phase,
    history,
    // Bij vraagmodus toont de gebruikersapp de begeleidersvraag als context; `null` bij een vrij gesprek.
    caregiverQuestion: session.caregiverQuestion,
  });
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
  { prisma, orchestrator, encryptor }: ConversationRoutesDeps,
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
      return buildState(prisma, orchestrator, encryptor, session, [], request.log);
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
        prisma,
        orchestrator,
        encryptor,
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

      const state = await buildState(
        prisma,
        orchestrator,
        encryptor,
        session,
        await loadSteps(prisma, session.id),
        request.log,
      );
      // De interpretatie-zekerheid van de nieuwe toestand vastleggen op de zojuist gezette stap
      // (§7.4; `ConversationStep.confidence` was `null` in de gescripte engine).
      if (typeof state.confidence === 'number') {
        await prisma.conversationStep.update({
          where: { id: created.id },
          data: { confidence: state.confidence },
        });
      }
      return state;
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
      // Vraagmodus (T7.1): de eerste stap is het door de begeleider gekozen topic-anker; dat mag de
      // gebruiker niet ongedaan maken (anders ontsnapt het gesprek uit de vraag naar het vrije
      // startscherm). Terug blijft wél mogelijk zolang er nog een eigen keuze bovenop het anker staat.
      if (session.mode === 'question' && steps.length === 1) {
        throw new HttpError(400, 'NO_STEPS_TO_UNDO', 'Er is geen keuze om ongedaan te maken.');
      }

      const last = steps[steps.length - 1]!;
      await prisma.conversationStep.delete({ where: { id: last.id } });

      return buildState(
        prisma,
        orchestrator,
        encryptor,
        session,
        await loadSteps(prisma, session.id),
        request.log,
      );
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
        // De concepten die op dit punt aangeboden (kunnen) worden, uitsluiten voor de rest van de sessie.
        // We rekenen ze hier opnieuw uit in plaats van de client te geloven: de bibliotheek bepaalt wat er
        // op dit punt bestaat (§7.6), en zo kan een client nooit iets uitsluiten dat hier niet hoort.
        const excludedNow = new Set<string>([
          ...steps.map((step) => step.selectedConcept),
          ...(await loadRejectedConcepts(prisma, session.id)),
        ]);
        const { available } = await findAvailableCandidates(prisma, steps, excludedNow);
        if (available.length === 0) {
          throw new HttpError(
            400,
            'NO_OPTIONS_TO_SKIP',
            'Er zijn hier geen andere opties om over te slaan.',
          );
        }
        await prisma.correctionEvent.createMany({
          data: available.map((symbol) => ({
            sessionId: session.id,
            type,
            stepOrder: steps.length,
            rejectedConcept: symbol.concept,
          })),
        });
        // Geen stappen teruggerold: de beslissingslaag zoekt vanzelf een niveau hoger verder (T9.14).
        return buildState(prisma, orchestrator, encryptor, session, steps, request.log);
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

      const { stepOrder, rejectedConcept } = analyzeCorrection(steps, anchored);

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
      return buildState(
        prisma,
        orchestrator,
        encryptor,
        session,
        await loadSteps(prisma, session.id),
        request.log,
      );
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
          data: { status: 'COMPLETED' },
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
