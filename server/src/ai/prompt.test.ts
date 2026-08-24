import { describe, expect, it } from 'vitest';
import {
  AAC_RULES,
  FREE_ROUND_RULES,
  GOAL,
  MESSAGE_AAC_RULES,
  MESSAGE_GOAL,
  MESSAGE_QUESTION_GOAL,
  MESSAGE_STATEMENT_RULES,
  SYSTEM_RULES,
  buildAiPrompt,
  buildMessagePrompt,
  renderMessagePromptText,
  renderPromptText,
} from './prompt.js';
import { AI_TASK_GENERATE_MESSAGE, AI_TASK_SELECT_NEXT_QUESTION } from './provider.js';

/**
 * T5.1-kernacceptatie: de prompt bevat **aantoonbaar alléén toegestane context**. We toetsen de
 * gesloten sleutelset, de afwezigheid van chatgeschiedenis, en dat gesprekscontext/opties puur
 * AAC-concepten zijn (geen vrije tekst/PII).
 */
describe('buildAiPrompt — beperkte context (DESIGN §7.7)', () => {
  const want = { concept: 'want', label: 'Iets willen' };
  const doActivity = { concept: 'do-activity', label: 'Iets doen' };
  const outside = { concept: 'outside', label: 'Buiten' };

  it('heeft precies de toegestane sleutelset (geen chatgeschiedenis, geen extra velden)', () => {
    const prompt = buildAiPrompt({
      conversationContext: [want],
      availableSymbols: [doActivity, outside],
    });

    expect(Object.keys(prompt).sort()).toEqual(
      [
        'aacRules',
        'askedQuestions',
        'availableSymbols',
        'conversationContext',
        'goal',
        'lastChoice',
        'questionContext',
        'rejectedConcepts',
        'systemRules',
        'task',
        'userContext',
      ].sort(),
    );
    // Expliciet: geen chat-/berichtenlog en geen vrije-invoervelden.
    expect(prompt).not.toHaveProperty('history');
    expect(prompt).not.toHaveProperty('messages');
    expect(prompt).not.toHaveProperty('chat');
  });

  it('draagt de vaste systeemregels, het doel en de AAC-regels mee', () => {
    const prompt = buildAiPrompt({ conversationContext: [], availableSymbols: [want] });
    expect(prompt.task).toBe(AI_TASK_SELECT_NEXT_QUESTION);
    expect(prompt.systemRules).toEqual([...SYSTEM_RULES]);
    expect(prompt.goal).toBe(GOAL);
    // De vraag moet in het Nederlands aan de gebruiker gesteld worden (T9.16): bij de rooktest met een
    // echte AI kwam er "Is the pain related to being sick?" op de tablet te staan.
    expect(prompt.goal).toContain('Nederlands');
    expect(prompt.aacRules).toEqual([...AAC_RULES]);
  });

  it('leidt de laatste keuze af uit de gesprekscontext', () => {
    const empty = buildAiPrompt({ conversationContext: [], availableSymbols: [want] });
    expect(empty.lastChoice).toBeNull();

    const withSteps = buildAiPrompt({
      conversationContext: [want, doActivity],
      availableSymbols: [outside],
    });
    expect(withSteps.lastChoice).toEqual(doActivity);
  });

  it('gebruikerscontext is standaard leeg (geen ongevraagde PII in de prompt)', () => {
    const prompt = buildAiPrompt({ conversationContext: [want], availableSymbols: [outside] });
    expect(prompt.userContext).toEqual([]);
  });

  it('neemt alléén meegegeven, toegestane gebruikerscontext op', () => {
    const prompt = buildAiPrompt({
      conversationContext: [want],
      availableSymbols: [outside],
      userContext: [{ kind: 'favorite', value: 'hond' }],
    });
    expect(prompt.userContext).toEqual([{ kind: 'favorite', value: 'hond' }]);
  });

  it('gesprekscontext en opties bevatten uitsluitend concept + label (geen vrije velden)', () => {
    const prompt = buildAiPrompt({
      conversationContext: [want],
      availableSymbols: [doActivity, outside],
    });
    for (const ref of [...prompt.conversationContext, ...prompt.availableSymbols]) {
      expect(Object.keys(ref).sort()).toEqual(['concept', 'label']);
    }
  });

  it('begeleidersvraag (vraagmodus) is standaard null en wordt anders letterlijk meegedragen (T7.1)', () => {
    const free = buildAiPrompt({ conversationContext: [want], availableSymbols: [outside] });
    expect(free.questionContext).toBeNull();

    const asked = buildAiPrompt({
      conversationContext: [want],
      availableSymbols: [outside],
      questionContext: 'Wat wil je drinken?',
    });
    expect(asked.questionContext).toBe('Wat wil je drinken?');
  });
});

describe('buildMessagePrompt — beperkte context voor boodschapgeneratie (T5.3, §7.7/§7.8)', () => {
  const want = { concept: 'want', label: 'Iets willen' };
  const outside = { concept: 'outside', label: 'Buiten' };

  it('heeft precies de toegestane sleutelset (geen chatgeschiedenis, geen opties/vraag)', () => {
    const prompt = buildMessagePrompt({ chosenConcepts: [want, outside] });
    expect(Object.keys(prompt).sort()).toEqual(
      ['aacRules', 'chosenConcepts', 'goal', 'systemRules', 'task', 'userContext'].sort(),
    );
    expect(prompt).not.toHaveProperty('history');
    expect(prompt).not.toHaveProperty('messages');
    expect(prompt).not.toHaveProperty('availableSymbols');
  });

  it('draagt de vaste systeem-, doel- en AAC-regels mee en de gekozen concepten', () => {
    const prompt = buildMessagePrompt({ chosenConcepts: [want, outside] });
    expect(prompt.task).toBe(AI_TASK_GENERATE_MESSAGE);
    expect(prompt.systemRules).toEqual([...SYSTEM_RULES]);
    expect(prompt.goal).toBe(MESSAGE_GOAL);
    expect(prompt.aacRules).toEqual([...MESSAGE_AAC_RULES, ...MESSAGE_STATEMENT_RULES]);
    expect(prompt.chosenConcepts).toEqual([want, outside]);
    expect(prompt.userContext).toEqual([]);
  });

  it('de gekozen concepten bevatten uitsluitend concept + label (geen vrije velden)', () => {
    const prompt = buildMessagePrompt({ chosenConcepts: [want, outside] });
    for (const ref of prompt.chosenConcepts) {
      expect(Object.keys(ref).sort()).toEqual(['concept', 'label']);
    }
  });

  it('renderMessagePromptText blijft binnen de gesloten set', () => {
    const text = renderMessagePromptText(buildMessagePrompt({ chosenConcepts: [want, outside] }));
    expect(text).toContain('SYSTEEMREGELS:');
    expect(text).toContain('BEVESTIGDE CONCEPTEN');
    expect(text).toContain('outside (Buiten)');
    expect(text.toLowerCase()).not.toContain('chatgeschiedenis:');
  });
});

describe('renderPromptText — serialisatie blijft binnen de gesloten set', () => {
  it('bevat de kopjes en lekt geen niet-toegestane context', () => {
    const text = renderPromptText(
      buildAiPrompt({
        conversationContext: [{ concept: 'want', label: 'Iets willen' }],
        availableSymbols: [{ concept: 'outside', label: 'Buiten' }],
      }),
    );
    expect(text).toContain('SYSTEEMREGELS:');
    expect(text).toContain('GESPREKSCONTEXT');
    expect(text).toContain('TOEGESTANE OPTIES:');
    expect(text).toContain('outside (Buiten)');
    expect(text.toLowerCase()).not.toContain('chatgeschiedenis:');
  });
});

/**
 * De prompt mag zichzelf niet tegenspreken (T14.3, DESIGN §7.5, §7.6).
 *
 * Gemeld in de zesde gebruikerstest: op de route "Een vraag stellen → Wat? → Eten" leverde 🤷 "Staat er
 * niet bij" opties als **nagel** op — een sprong naar een heel ander onderwerp. Dat was geen modelfout.
 * De prompt bevatte twee instructies die elkaar uitsloten: `FREE_ROUND_RULES` (T10.13) zei *"blijf bij het
 * onderwerp van het pad"*, terwijl `AAC_RULES` bij `no_fitting_option` zei *"je zocht in de verkeerde
 * richting: verleg de invalshoek"*. De `calm`-strategie voegde daar nog *"maak geen onverwachte sprong naar
 * een ander onderwerp"* aan toe. Welke het model volgde, was een gok.
 *
 * Deze tests houden die tegenspraak weg: een afwijzing betekent "dit woord stond er niet bij", niet "dit
 * onderwerp is fout" — van onderwerp wisselen mag alleen na herhaalde afwijzing op hetzelfde punt.
 */
describe('promptregels spreken elkaar niet tegen (T14.3)', () => {
  /** Formuleringen die het model onvoorwaardelijk van onderwerp laten wisselen. */
  const ONVOORWAARDELIJKE_KOERSWIJZIGING = [/verleg de invalshoek/i, /verkeerde richting/i];

  it('vraagt bij "geen van deze past" om ándere concepten binnen hetzelfde onderwerp', () => {
    const regel = AAC_RULES.find((rule) => rule.includes('no_fitting_option'));
    expect(regel).toBeDefined();
    expect(regel!).toMatch(/blijf in dezelfde gesprekslijn/i);
    // En het omgekeerde staat er niet meer in.
    for (const patroon of ONVOORWAARDELIJKE_KOERSWIJZIGING) {
      expect(regel!).not.toMatch(patroon);
    }
  });

  it('staat van onderwerp wisselen alleen toe na herhaalde afwijzing', () => {
    const regel = AAC_RULES.find((rule) => /wissel alleen van onderwerp/i.test(rule));
    expect(regel).toBeDefined();
    expect(regel!).toMatch(/herhaaldelijk/i);
  });

  it('spreekt de vrije-ronde-opdracht nergens tegen', () => {
    // De vrije ronde vraagt om verfijningen binnen het pad; geen enkele andere regel — en ook het doel
    // niet — mag daar tegenin gaan, in welke combinatie de prompt ook wordt gebouwd.
    expect(FREE_ROUND_RULES.join(' ')).toMatch(/blijf bij het onderwerp/i);

    for (const refining of [false, true]) {
      for (const freeRound of [false, true]) {
        const prompt = buildAiPrompt({
          conversationContext: [
            { concept: 'ask', label: 'Een vraag stellen' },
            { concept: 'ask-what', label: 'Wat?' },
            { concept: 'eat', label: 'Eten' },
          ],
          availableSymbols: freeRound ? [] : [{ concept: 'bread', label: 'Brood' }],
          rejectedConcepts: [{ concept: 'apple', label: 'Appel', kind: 'no_fitting_option' }],
          refining,
          freeRound,
        });
        const tekst = [prompt.goal, ...prompt.aacRules, ...prompt.systemRules].join(' ');
        for (const patroon of ONVOORWAARDELIJKE_KOERSWIJZIGING) {
          expect(tekst).not.toMatch(patroon);
        }
      }
    }
  });

  it('houdt ook het doel bij de gesprekslijn van de gebruiker', () => {
    expect(GOAL).toMatch(/blijf in de gesprekslijn/i);
    for (const patroon of ONVOORWAARDELIJKE_KOERSWIJZIGING) {
      expect(GOAL).not.toMatch(patroon);
    }
  });
});

/**
 * De boodschap-prompt van een **vraagroute** (T14.1, DESIGN §3.1, §7.1 taak 4).
 *
 * `MESSAGE_GOAL` schrijft de ik-vorm voor. Voor een wens klopt dat, maar het verbood precies de zin die
 * de gebruiker in de zesde gebruikerstest wilde stellen: "Wat eten we vandaag?".
 */
describe('boodschap-prompt voor een vraagroute (T14.1)', () => {
  const route = [
    { concept: 'ask', label: 'Een vraag stellen' },
    { concept: 'ask-what', label: 'Wat?' },
    { concept: 'eat', label: 'Eten' },
  ];

  it('vraagt om een vraagzin in plaats van een mededeling in de ik-vorm', () => {
    const prompt = buildMessagePrompt({ chosenConcepts: route, questionRoute: true });
    expect(prompt.goal).toBe(MESSAGE_QUESTION_GOAL);
    expect(prompt.goal).toMatch(/vraagzin/i);
    expect(prompt.goal).not.toMatch(/in de ik-vorm zou zeggen/i);
    // En de regel die een vraag verbiedt, blijft weg.
    expect(prompt.aacRules).not.toContain(MESSAGE_STATEMENT_RULES[0]);
  });

  it('houdt een wensroute ongewijzigd bij de ik-vorm', () => {
    const prompt = buildMessagePrompt({
      chosenConcepts: [
        { concept: 'want', label: 'Iets willen' },
        { concept: 'eat', label: 'Eten' },
      ],
    });
    expect(prompt.goal).toBe(MESSAGE_GOAL);
    expect(prompt.aacRules).toContain(MESSAGE_STATEMENT_RULES[0]);
  });

  it('houdt de gesloten sleutelset ook voor een vraagroute', () => {
    const prompt = buildMessagePrompt({ chosenConcepts: route, questionRoute: true });
    expect(Object.keys(prompt).sort()).toEqual([
      'aacRules',
      'chosenConcepts',
      'goal',
      'systemRules',
      'task',
      'userContext',
    ]);
  });
});
