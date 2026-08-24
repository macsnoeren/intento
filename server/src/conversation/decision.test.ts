import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import { MockAiProvider } from '../ai/mock-provider.js';
import type { AiPrompt, AiProvider, AiQuestionDecision } from '../ai/provider.js';
import { decideNextQuestion } from './decision.js';

/**
 * AI-beslissingslaag (T5.2, DESIGN §7.4–7.6, §7.8). Toetst de kern-acceptatie los van HTTP:
 * onbekende concepten bereiken de gebruiker nooit, herhaalde opties worden uitgesloten, en de
 * confidence stuurt de fase (select/refine/propose) en de ordening.
 */
describe('decideNextQuestion — validatie, herhaling en confidence', () => {
  const mockOrchestrator = new AiOrchestrator(new MockAiProvider());

  /** Bouwt een orchestrator om een provider die een vaste beslissing teruggeeft (voor gerichte tests). */
  function stubOrchestrator(decision: AiQuestionDecision): AiOrchestrator {
    const provider: AiProvider = {
      name: 'stub',
      selectNextQuestion: () => Promise.resolve(decision),
    };
    return new AiOrchestrator(provider);
  }

  const steps = (...concepts: string[]) => concepts.map((selectedConcept) => ({ selectedConcept }));
  const conceptsOf = (d: Awaited<ReturnType<typeof decideNextQuestion>>) =>
    (d.question?.options ?? []).map((o) => o.concept);

  beforeAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
  });

  beforeEach(async () => {
    await prisma.conceptProposal.deleteMany();
  });

  afterAll(async () => {
    await prisma.conceptProposal.deleteMany();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  it('kiest bij de start de intentie-categorieën (fase select bij lage zekerheid)', async () => {
    const decision = await decideNextQuestion(prisma, mockOrchestrator, { steps: steps() });
    expect(decision.done).toBe(false);
    expect(conceptsOf(decision)).toEqual(
      expect.arrayContaining(['want', 'feel', 'problem', 'ask', 'say']),
    );
    expect(decision.phase).toBe('select');
  });

  it('verfijnt na een keuze (fase refine) en sluit het al gekozen concept uit', async () => {
    const decision = await decideNextQuestion(prisma, mockOrchestrator, { steps: steps('want') });
    expect(decision.phase).toBe('refine');
    expect(conceptsOf(decision)).toEqual(expect.arrayContaining(['do-activity', 'eat', 'drink']));
    expect(conceptsOf(decision)).not.toContain('want');
  });

  it('stelt bij een eindconcept een boodschap voor (propose, geen vraag)', async () => {
    const decision = await decideNextQuestion(prisma, mockOrchestrator, {
      steps: steps('want', 'do-activity', 'outside', 'walking', 'dog'),
    });
    expect(decision.done).toBe(true);
    expect(decision.question).toBeNull();
    expect(decision.phase).toBe('propose');
  });

  it('laat een door de AI voorgesteld ONBEKEND concept nooit bij de gebruiker komen', async () => {
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je?',
      confidence: 0.7,
      reason: 'de gebruiker wil iets nieuws',
      options: [
        { symbol: 'faketeleport', confidence: 0.9 },
        { symbol: 'do-activity', confidence: 0.7 },
      ],
    });
    const decision = await decideNextQuestion(prisma, orchestrator, { steps: steps('want') });

    // Het onbekende concept is weggelaten; de AI-keuze staat vooraan en de overige kandidaten van dit
    // punt volgen erachter (T9.10: de AI ordent, ze snoeit de bibliotheek niet weg).
    expect(conceptsOf(decision)[0]).toBe('do-activity');
    expect(conceptsOf(decision)).not.toContain('faketeleport');
    expect(decision.proposed).toEqual(['faketeleport']);
    const proposal = await prisma.conceptProposal.findUnique({
      where: { concept: 'faketeleport' },
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.status).toBe('PENDING');
  });

  it('sluit een al gekozen concept uit, ook als de AI het opnieuw aanbiedt (herhaling vermijden)', async () => {
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je?',
      confidence: 0.7,
      reason: 'herhaalt een eerdere keuze',
      options: [
        { symbol: 'want', confidence: 0.95 }, // al gekozen → moet wegvallen
        { symbol: 'do-activity', confidence: 0.6 },
      ],
    });
    const decision = await decideNextQuestion(prisma, orchestrator, { steps: steps('want') });
    expect(conceptsOf(decision)).not.toContain('want');
    // De door de AI gekozen optie staat vooraan; de rest van de kandidaten volgt (T9.10).
    expect(conceptsOf(decision)[0]).toBe('do-activity');
  });

  it('biedt op het startscherm alle intentiecategorieën aan, ook als de AI er één kiest (T9.10)', async () => {
    // In de gebruikerstest gaf een echte AI het startscherm met één optie terug; dan kiest de AI de
    // intentie in plaats van de gebruiker. De AI mag ordenen, niet snoeien.
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je?',
      confidence: 0.7,
      reason: 'de gebruiker wil vast iets',
      options: [{ symbol: 'want', confidence: 0.9 }],
    });
    const decision = await decideNextQuestion(prisma, orchestrator, { steps: steps() });

    const intents = await prisma.aacSymbol.findMany({ where: { category: 'intent' } });
    expect(conceptsOf(decision)).toHaveLength(intents.length);
    // De keuze van de AI staat wél vooraan (dat is wat de tablet als eerste toont).
    expect(conceptsOf(decision)[0]).toBe('want');
    expect(decision.done).toBe(false);
  });

  it('stelt niets voor zolang alleen het begeleiders-anker gezet is (T9.14)', async () => {
    // Vraagmodus: stap 0 is het anker van de begeleider. Ook een zeer zekere AI mag daarop geen
    // "boodschap van de gebruiker" voorstellen — de gebruiker heeft nog niets gekozen.
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je drinken?',
      confidence: 0.99,
      reason: 'heel zeker',
      options: [{ symbol: 'water', confidence: 0.99 }],
    });
    const withAnchor = await decideNextQuestion(prisma, orchestrator, {
      steps: steps('drink'),
      questionContext: 'Wat wil je drinken?',
      anchoredSteps: 1,
    });
    expect(withAnchor.done).toBe(false);
    expect(conceptsOf(withAnchor)).toContain('water');

    // Zonder anker (vrij gesprek) levert een afgemaakte route wél een voorstel: daar koos de gebruiker
    // zelf. "water" is een eindconcept, dus er valt niets meer te verfijnen (T10.10).
    const freeChoice = await decideNextQuestion(prisma, orchestrator, {
      steps: steps('drink', 'water'),
    });
    expect(freeChoice.done).toBe(true);
  });

  it('zoekt een niveau hoger als alle opties van dit punt zijn uitgesloten (T9.14)', async () => {
    // Na een ❌-correctie kan een tak leeg raken. Dan hoort er een andere vraag te komen, geen
    // boodschap uit het niets: in de gebruikerstest stelde de app een boodschap voor die de gebruiker
    // nooit gekozen had.
    const painChildren = await prisma.aacConceptRelation.findMany({
      where: { parent: { concept: 'pain' } },
      include: { child: true },
    });
    const excluded = painChildren.map((relation) => relation.child.concept);

    const decision = await decideNextQuestion(prisma, mockOrchestrator, {
      steps: steps('problem', 'pain'),
      rejections: excluded.map((concept) => ({ concept, kind: 'wrong_guess' as const })),
    });
    expect(decision.done).toBe(false);
    expect(decision.diagnostics.widened).toBe(true);
    // De opties komen nu van een niveau hoger (de andere problemen), niet uit het uitgesloten niveau.
    expect(conceptsOf(decision).length).toBeGreaterThan(0);
    for (const concept of conceptsOf(decision)) {
      expect(excluded).not.toContain(concept);
    }
  });

  it('blijft bij een écht eindconcept gewoon een boodschap voorstellen', async () => {
    // Onderscheid met de test hierboven: "water" heeft in de bibliotheek géén kinderen (eindconcept),
    // dus daar is de route af — niet omhoog zoeken.
    const decision = await decideNextQuestion(prisma, mockOrchestrator, {
      steps: steps('drink', 'water'),
    });
    expect(decision.done).toBe(true);
    expect(decision.diagnostics.widened).toBe(false);
  });

  it('sluit expliciet uitgesloten concepten uit (bv. afgewezen keuze bij correctie, T5.4)', async () => {
    const decision = await decideNextQuestion(prisma, mockOrchestrator, {
      steps: steps('want'),
      rejections: [{ concept: 'eat', kind: 'wrong_guess' }],
    });
    expect(conceptsOf(decision)).not.toContain('eat');
    expect(conceptsOf(decision)).toEqual(expect.arrayContaining(['do-activity', 'drink']));
  });

  it('ordent de opties op zekerheid (meest waarschijnlijke eerst)', async () => {
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je?',
      confidence: 0.7,
      reason: 'ongesorteerd',
      options: [
        { symbol: 'do-activity', confidence: 0.3 },
        { symbol: 'eat', confidence: 0.9 },
        { symbol: 'drink', confidence: 0.6 },
      ],
    });
    const decision = await decideNextQuestion(prisma, orchestrator, { steps: steps('want') });
    // De door de AI gekozen opties staan vooraan, op zekerheid geordend; de overige kandidaten van dit
    // punt volgen erachter (T9.10: de AI ordent, ze snoeit de bibliotheek niet weg).
    expect(conceptsOf(decision).slice(0, 3)).toEqual(['eat', 'drink', 'do-activity']);
    expect(conceptsOf(decision).length).toBeGreaterThan(3);
  });

  it('stelt vroegtijdig een boodschap voor bij hoge interpretatie-zekerheid (>85%)', async () => {
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je?',
      confidence: 0.92,
      reason: 'zeer zeker',
      options: [{ symbol: 'do-activity', confidence: 0.8 }],
    });
    // Alle verfijningen van "want" zijn al gezien en afgewezen, dus er valt niets meer te vragen
    // (T10.10): dán mag de hoge zekerheid de doorslag geven.
    const decision = await decideNextQuestion(prisma, orchestrator, {
      steps: steps('want'),
      rejections: ['eat', 'drink', 'do-activity'].map((concept) => ({
        concept,
        kind: 'no_fitting_option' as const,
      })),
      allowNewConcepts: false,
    });
    expect(decision.done).toBe(true);
    expect(decision.question).toBeNull();
    expect(decision.phase).toBe('propose');
  });

  it('stelt NIET voor zolang er nog te verfijnen valt, hoe zeker de AI ook is (T10.10)', async () => {
    // De bevinding uit de gebruikerstest: op "eten" kwam de boodschap "Ik wil iets warms eten." terwijl
    // de bibliotheek onder "eten" zes concrete dingen kent. Zeker weten dát iemand wil eten is niet
    // hetzelfde als weten wát; dan hoort de AI door te vragen.
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je eten?',
      confidence: 0.99,
      reason: 'heel zeker dat het om eten gaat',
      options: [{ symbol: 'soup', confidence: 0.9 }],
    });
    const decision = await decideNextQuestion(prisma, orchestrator, {
      steps: steps('want', 'eat'),
    });

    expect(decision.done).toBe(false);
    expect(decision.question).not.toBeNull();
    // En de vraag gaat over wat er te eten valt, niet over iets anders.
    expect(conceptsOf(decision)).toEqual(expect.arrayContaining(['soup', 'bread', 'apple']));
  });

  it('stelt aan de start nooit voor, ook niet bij hoge zekerheid (er is nog niets gekozen)', async () => {
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je duidelijk maken?',
      confidence: 0.95,
      reason: 'zeker maar geen route',
      options: [{ symbol: 'want', confidence: 0.9 }],
    });
    const decision = await decideNextQuestion(prisma, orchestrator, { steps: steps() });
    expect(decision.done).toBe(false);
    expect(decision.question).not.toBeNull();
  });

  it('geeft de AI het lábel van de gekozen route mee, niet de conceptsleutel', async () => {
    // De gekozen concepten staan per definitie niet in de kandidatenset (ze zijn uitgesloten). Zoeken we
    // hun labels niet apart op, dan krijgt het model 'want' in plaats van 'Iets willen' — en formuleert
    // het vragen als: Wat past het best bij "want"?
    let seen: AiPrompt | null = null;
    const spy: AiProvider = {
      name: 'spy',
      selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
        seen = prompt;
        return Promise.resolve({
          question: 'Wat wil je?',
          options: [],
          confidence: 0.5,
          reason: 'spy',
        });
      },
    };

    await decideNextQuestion(prisma, new AiOrchestrator(spy), { steps: steps('want') });

    const prompt = seen as AiPrompt | null;
    expect(prompt).not.toBeNull();
    expect(prompt!.lastChoice).toEqual({ concept: 'want', label: 'Iets willen' });
    expect(prompt!.conversationContext).toEqual([{ concept: 'want', label: 'Iets willen' }]);
  });

  // --- T14.2: een vraag is af zodra het onderwerp bekend is ------------------------------------------

  it('stelt een afgeronde vraag voor zonder eerst door te vragen (T14.2)', async () => {
    // Zesde gebruikerstest: op `ask → ask-what → eat` eiste de voorsteldrempel verfijning omdat "eten"
    // zes kinderen heeft. De gebruiker kreeg "wat wil je eten?" terwijl zijn vraag ("Wat eten we?") al
    // af was — doorvragen maakt er een andere zin van.
    const orchestrator = stubOrchestrator({
      question: 'Bedoel je dit?',
      options: [],
      confidence: 0.95,
      reason: 'zeker genoeg voor een voorstel',
    });
    const decision = await decideNextQuestion(prisma, orchestrator, {
      steps: steps('ask', 'ask-what', 'eat'),
    });

    expect(decision.done).toBe(true);
    expect(decision.phase).toBe('propose');
    expect(decision.question).toBeNull();
  });

  it('blijft bij een wens wél doorvragen (T10.10 blijft gelden)', async () => {
    const orchestrator = stubOrchestrator({
      question: 'Bedoel je dit?',
      options: [],
      confidence: 0.95,
      reason: 'zeker genoeg voor een voorstel',
    });
    const decision = await decideNextQuestion(prisma, orchestrator, {
      steps: steps('want', 'eat'),
    });

    expect(decision.done).toBe(false);
    expect(decision.question).not.toBeNull();
  });

  it('vraagt bij een vraag zonder onderwerp nog wél door (T14.2)', async () => {
    // "Wat is dat?" zonder onderwerp is te vaag om als boodschap voor te stellen.
    const orchestrator = stubOrchestrator({
      question: 'Bedoel je dit?',
      options: [],
      confidence: 0.95,
      reason: 'zeker genoeg voor een voorstel',
    });
    const decision = await decideNextQuestion(prisma, orchestrator, {
      steps: steps('ask', 'ask-what'),
    });

    expect(decision.done).toBe(false);
    expect(decision.question).not.toBeNull();
  });
});
