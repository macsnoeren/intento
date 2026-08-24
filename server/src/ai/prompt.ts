import {
  AI_TASK_GENERATE_MESSAGE,
  AI_TASK_SELECT_NEXT_QUESTION,
  aiMessagePromptSchema,
  aiPromptSchema,
  type AiConceptRef,
  type AiMessagePrompt,
  type AiPrompt,
  type AiRejectedConcept,
  type AiUserContextItem,
} from './provider.js';

/**
 * Samenstellen van de **beperkte, verse context** per AI-aanroep (T5.1, DESIGN §7.7, §7.8).
 *
 * Dit is de enige plek die een `AiPrompt` vormt. Elke aanroep krijgt uitsluitend:
 * `systeemregels + doel + AAC-regels + gebruikerscontext + gesprekscontext + laatste keuze +
 * toegestane opties + gestelde vragen + afgewezen concepten`. Er is **geen** veld voor chatgeschiedenis
 * of vrije gebruikersinvoer — de sleutelset is gesloten (afgedwongen door `aiPromptSchema`), zodat
 * aantoonbaar alléén toegestane context de provider bereikt. De gesprekscontext zijn puur de gekozen
 * AAC-concepten (geen tekstlog), en de aangeboden opties komen uit de beheerde bibliotheek.
 *
 * Sinds T10.4 reist ook de **negatieve** context mee (`askedQuestions`, `rejectedConcepts`, DESIGN §7.5):
 * zonder die velden zag het model alleen een kortere optielijst en herhaalde het zijn redenering, waardoor
 * "geen van deze past" geen enkel effect had op de richting van het gesprek. Ook dit blijft gesloten en
 * afgeleid: het zijn AAC-concepten en door het systeem geformuleerde vragen, geen vrije tekst van de
 * gebruiker.
 *
 * Sinds T11.2 leveren het **doel** en de **AAC-regels** hun inhoud uit de actieve gespreksstrategie
 * (DESIGN §7.10). Dat verandert niets aan de vorm: de sleutelset blijft gesloten en `buildAiPrompt`
 * blijft de enige bouwer — een strategie vult velden, ze voegt er nooit een toe.
 */

/**
 * Harde systeem-/veiligheidsregels (DESIGN §7.8). Deze reizen bij élke aanroep mee en begrenzen wat het
 * model mag: nooit een boodschap verzinnen, geen persoonlijke info toevoegen zonder toestemming, nooit
 * namens de gebruiker spreken, en binnen de aangeboden AAC-concepten blijven. Bewust een vaste lijst.
 */
export const SYSTEM_RULES: readonly string[] = [
  'Je bent een hulpmiddel dat de gebruiker helpt zijn eigen intentie te vinden; je bent geen chatbot.',
  'Je verzint nooit een boodschap zonder basis in de keuzes van de gebruiker.',
  'Je voegt nooit persoonlijke informatie toe die niet expliciet in de context staat.',
  'Je spreekt nooit namens de gebruiker; de gebruiker blijft eigenaar van de boodschap.',
  'Je biedt alleen keuzes aan; de gebruiker kiest zelf en bevestigt zelf.',
  'Je krijgt per beurt verse, beperkte context — geen chatgeschiedenis; baseer je alleen hierop.',
];

/** Het doel van Intento zoals het model het per aanroep meekrijgt (DESIGN §1, §7.1). */
export const GOAL =
  'Achterhaal wat de gebruiker wil zeggen. Bepaal de meest waardevolle volgende pictogramvraag: ' +
  'verminder onzekerheid, overlaad de gebruiker niet, en kies de snelste route naar de bedoelde ' +
  'betekenis. Kijk daarbij naar wat de gebruiker al koos én naar wat hij afwees — een afwijzing zegt dat ' +
  'je nog niet het juiste woord had, niet dat het onderwerp fout is. Blijf in de gesprekslijn die de ' +
  'gebruiker met zijn keuzes heeft uitgezet en zoek dáárbinnen verder. Formuleer de vraag in het ' +
  'Nederlands, kort en eenvoudig, en richt je rechtstreeks tot de gebruiker.';

/** AAC-begrenzingsregels (DESIGN §7.6). */
export const AAC_RULES: readonly string[] = [
  'Kies bij voorkeur uit de aangeboden "availableSymbols"; dat zijn bestaande, beheerde pictogrammen.',
  'Staat het begrip dat de gebruiker nodig heeft er aantoonbaar niet bij, dan mag je één nieuw, kort ' +
    'Nederlands begrip voorstellen — controleer eerst of het niet al als optie bestaat, ook niet onder ' +
    'een ander woord. Verzin nooit een nieuw begrip als er een passende bestaande optie is.',
  'Herhaal geen vraag of optie die al eerder in de gesprekscontext is gekozen.',
  'Bied geen concept aan dat in "rejectedConcepts" staat.',
  'Staat er een concept met soort "no_fitting_option" bij de afwijzingen, dan stond het woord van de ' +
    'gebruiker niet tussen de aangeboden opties. Dat zegt niets over het onderwerp: blijf in dezelfde ' +
    'gesprekslijn en draag ándere concepten binnen dat onderwerp aan, desnoods zelfbedachte.',
  'Wissel alleen van onderwerp als de gebruiker op hetzelfde punt herhaaldelijk heeft afgewezen en er ' +
    'binnen dat onderwerp aantoonbaar niets meer te bedenken valt.',
  'Stel geen vraag die al in "askedQuestions" staat, ook niet in andere bewoordingen.',
];

/** Het doel bij boodschapgeneratie (T5.3, DESIGN §7.1 taak 4, §7.8). */
export const MESSAGE_GOAL =
  'Vorm uit de bevestigde concepten één korte, natuurlijke Nederlandse zin die de gebruiker zelf in de ' +
  'ik-vorm zou zeggen. Blijf strikt binnen de gekozen concepten: voeg geen nieuwe onderwerpen, personen, ' +
  'plekken of activiteiten toe die niet in "chosenConcepts" staan.';

/** AAC-begrenzingsregels specifiek voor de boodschapgeneratie (DESIGN §7.6, §7.8). */
export const MESSAGE_AAC_RULES: readonly string[] = [
  'Gebruik uitsluitend de concepten uit "chosenConcepts"; verzin geen extra begrippen.',
  'Voeg geen persoonlijke informatie toe die niet in de context staat.',
  'Formuleer één enkele zin — geen vraag, geen opsomming, geen toelichting.',
];

/** Invoer voor de promptbouw: de reeds gezette route, de toegestane opties en (later) gebruikerscontext. */
export interface AiPromptInput {
  /** De tot nu toe gekozen concepten (oplopend op volgorde). Leeg = startvraag. */
  conversationContext: AiConceptRef[];
  /** De op dit moment toegestane opties (AAC-begrensd), reeds geladen door de aanroeper. */
  availableSymbols: AiConceptRef[];
  /**
   * Toegestane gebruikerscontext (DESIGN §7.7). Optioneel en in deze fase doorgaans leeg; T6.1 vult
   * dit met **alleen** de context waarvoor toestemming (`aiUsageAllowed=true`) is gegeven.
   */
  userContext?: AiUserContextItem[];
  /**
   * De begeleidersvraag bij de **vraagmodus** (T7.1, DESIGN §3.2). Optioneel; `null`/weggelaten bij een
   * vrij gesprek. Reist als context mee zodat de AI de antwoorden op de vraag afstemt.
   */
  questionContext?: string | null;
  /** De eerder gestelde vragen in deze sessie (T10.4, §7.5); leeg aan het begin. */
  askedQuestions?: string[];
  /** De afgewezen concepten met hun soort afwijzing (T10.4, §7.5); leeg als er niets is afgewezen. */
  rejectedConcepts?: AiRejectedConcept[];
  /**
   * Het doel zoals de **gespreksstrategie** het formuleert (T11.2, DESIGN §7.10); weggelaten = `GOAL`.
   * Een strategie vult hier de *inhoud* van een bestaand veld; de sleutelset van de prompt blijft
   * gesloten (zie de moduletoelichting) — een strategie kan er nooit een veld bij verzinnen.
   */
  goal?: string;
  /** De AAC-regels van de strategie (T11.2); weggelaten = `AAC_RULES`. De harde regels blijven erin. */
  aacRules?: readonly string[];
  /**
   * Draait er een **verfijnronde** na ❌ Nee (T10.12)? Dan krijgt het model er een expliciete opdracht bij:
   * de route klopt, maar hij is nog niet precies genoeg. Zonder die aanwijzing zou het model de afwijzing
   * lezen als "verkeerde richting" en van onderwerp veranderen — precies wat de gebruiker níet wil.
   */
  refining?: boolean;
  /**
   * Is dit een **vrije ronde** (T10.13, §7.6 trap 3)? Dan is `availableSymbols` leeg omdat de bibliotheek
   * niets specifiekers onder de laatste keuze kent, en moet het model zélf begrippen aandragen. Zonder
   * die aanwijzing leest een leeg optieveld als "er is niets" in plaats van als "verzin het zelf".
   */
  freeRound?: boolean;
}

/**
 * Extra opdracht tijdens een verfijnronde (T10.12, DESIGN §3.4). Gemeld in de gebruikerstest: op
 * "Ik wil brood eten." wilde de gebruiker zeggen dat hij er chocopasta op wil — maar ❌ leverde appel en
 * banaan op, de bróérs van brood. De laatste keuze is dan juist het onderwerp dat verder moet.
 */
export const REFINE_RULES: readonly string[] = [
  'De gebruiker wees de boodschap af omdat die nog niet precies genoeg is, niet omdat de richting fout ' +
    'is: zijn laatste keuze klopt en moet juist verder ingevuld worden.',
  'Draag concepten aan die de laatste keuze **preciezer** maken (bij "brood": beleg, kaas, chocopasta), ' +
    'niet de broertjes ervan (appel, banaan) en niet een ander onderwerp.',
  'Staan die verfijningen niet in de aangeboden opties, dan mag je ze zelf aandragen als nieuw begrip.',
];

/**
 * Extra opdracht tijdens een vrije ronde (T10.13, DESIGN §7.6 trap 3). Op dit punt is `availableSymbols`
 * leeg: boom én retrieval kennen niets specifiekers onder de laatste keuze.
 *
 * Aanleiding is de gebruikerstest op het pad "Iets willen → Eten → Brood → Beleg". Tot T10.13 kreeg het
 * model daar een greep uit de bibliotheek als optielijst, en omdat de AAC-regels zeggen "kies bij voorkeur
 * uit de aangeboden opties" koos het braaf: "pijn", "nagel", "er is iets aan de hand" — en de vraag sloeg
 * om naar "Wat wil je drinken?". Een lege lijst plus een expliciete opdracht is eerlijker: het pad staat
 * er, en daar is prima een verfijning bij te bedenken.
 */
export const FREE_ROUND_RULES: readonly string[] = [
  'Er staan geen bestaande opties in "availableSymbols": de bibliotheek kent nog niets specifiekers ' +
    'onder de laatste keuze van de gebruiker. Dat is geen fout — het is jouw beurt om aan te dragen.',
  'Draag twee tot vijf concrete begrippen aan die de laatste keuze preciezer maken en die logisch bij ' +
    'het gekozen pad passen (bij "Iets willen > Eten > Brood > Beleg": kaas, chocopasta, hagelslag).',
  'Blijf bij het onderwerp van het pad: wissel niet van onderwerp omdat je geen bestaande opties ziet, ' +
    'en stel je vraag over de laatste keuze.',
];

/**
 * Vormt de beperkte context tot een gevalideerde `AiPrompt`. De laatste keuze wordt afgeleid uit de
 * gesprekscontext (de laatst gekozen concept), zodat er nooit een losse, afwijkende "laatste keuze"
 * ingeslopen kan zijn. Het resultaat wordt door `aiPromptSchema` geparseerd: de gesloten sleutelset is
 * daarmee gegarandeerd (T5.1-acceptatie: alléén toegestane context).
 */
export function buildAiPrompt(input: AiPromptInput): AiPrompt {
  const conversationContext = input.conversationContext;
  const lastChoice =
    conversationContext.length > 0 ? conversationContext[conversationContext.length - 1]! : null;
  return aiPromptSchema.parse({
    task: AI_TASK_SELECT_NEXT_QUESTION,
    systemRules: [...SYSTEM_RULES],
    goal: input.goal ?? GOAL,
    aacRules: [
      ...(input.aacRules ?? AAC_RULES),
      ...(input.refining ? REFINE_RULES : []),
      ...(input.freeRound ? FREE_ROUND_RULES : []),
    ],
    userContext: input.userContext ?? [],
    questionContext: input.questionContext ?? null,
    conversationContext,
    lastChoice,
    availableSymbols: input.availableSymbols,
    askedQuestions: input.askedQuestions ?? [],
    rejectedConcepts: input.rejectedConcepts ?? [],
  });
}

/**
 * Serialiseert de prompt naar een compacte, deterministische tekst voor een echte LLM-provider. Bewust
 * alléén de velden uit `AiPrompt` (de gesloten set) — er kan hier geen extra context inlekken. De mock
 * gebruikt deze functie niet (die leest het gestructureerde object rechtstreeks); ze bestaat zodat een
 * latere tekst-gebaseerde provider dezelfde begrensde context krijgt.
 */
export function renderPromptText(prompt: AiPrompt): string {
  const lines: string[] = [];
  lines.push(`TAAK: ${prompt.task}`);
  lines.push('', 'SYSTEEMREGELS:');
  for (const rule of prompt.systemRules) lines.push(`- ${rule}`);
  lines.push('', `DOEL: ${prompt.goal}`);
  lines.push('', 'AAC-REGELS:');
  for (const rule of prompt.aacRules) lines.push(`- ${rule}`);
  lines.push('', 'GEBRUIKERSCONTEXT:');
  for (const item of prompt.userContext) lines.push(`- ${item.kind}: ${item.value}`);
  lines.push('', `BEGELEIDERSVRAAG: ${prompt.questionContext ?? '(geen)'}`);
  lines.push('', 'GESPREKSCONTEXT (gekozen concepten):');
  for (const ref of prompt.conversationContext) lines.push(`- ${ref.concept} (${ref.label})`);
  lines.push('', `LAATSTE KEUZE: ${prompt.lastChoice ? prompt.lastChoice.concept : '(geen)'}`);
  lines.push('', 'TOEGESTANE OPTIES:');
  for (const ref of prompt.availableSymbols) lines.push(`- ${ref.concept} (${ref.label})`);
  lines.push('', 'AL GESTELDE VRAGEN (niet herhalen):');
  for (const question of prompt.askedQuestions) lines.push(`- ${question}`);
  lines.push('', 'AFGEWEZEN DOOR DE GEBRUIKER (niet opnieuw aanbieden):');
  for (const rejected of prompt.rejectedConcepts) {
    lines.push(`- ${rejected.concept} (${rejected.label}) — ${rejected.kind}`);
  }
  return lines.join('\n');
}

/** Invoer voor de boodschap-prompt: de bevestigde concepten en (later) toegestane gebruikerscontext. */
export interface AiMessagePromptInput {
  /** De bevestigde concepten (oplopend op volgorde; de eerste is de intentie). */
  chosenConcepts: AiConceptRef[];
  /**
   * Toegestane gebruikerscontext (DESIGN §7.7). Optioneel en in deze fase doorgaans leeg; T6.1 vult
   * dit met **alleen** de context waarvoor toestemming (`aiUsageAllowed=true`) is gegeven.
   */
  userContext?: AiUserContextItem[];
}

/**
 * Vormt de beperkte context voor boodschapgeneratie tot een gevalideerde `AiMessagePrompt` (T5.3).
 * Net als `buildAiPrompt` is dit de enige plek die dit object vormt: de gesloten sleutelset (afgedwongen
 * door `aiMessagePromptSchema`) garandeert dat er geen chatgeschiedenis of vrije invoer inlekt.
 */
export function buildMessagePrompt(input: AiMessagePromptInput): AiMessagePrompt {
  return aiMessagePromptSchema.parse({
    task: AI_TASK_GENERATE_MESSAGE,
    systemRules: [...SYSTEM_RULES],
    goal: MESSAGE_GOAL,
    aacRules: [...MESSAGE_AAC_RULES],
    userContext: input.userContext ?? [],
    chosenConcepts: input.chosenConcepts,
  });
}

/**
 * Serialiseert de boodschap-prompt naar compacte, deterministische tekst voor een echte LLM-provider —
 * uitsluitend de velden uit `AiMessagePrompt` (de gesloten set), zodat er geen extra context inlekt. De
 * mock gebruikt dit niet; het bestaat zodat een latere tekst-gebaseerde provider dezelfde begrensde
 * context krijgt (symmetrisch met `renderPromptText`).
 */
export function renderMessagePromptText(prompt: AiMessagePrompt): string {
  const lines: string[] = [];
  lines.push(`TAAK: ${prompt.task}`);
  lines.push('', 'SYSTEEMREGELS:');
  for (const rule of prompt.systemRules) lines.push(`- ${rule}`);
  lines.push('', `DOEL: ${prompt.goal}`);
  lines.push('', 'AAC-REGELS:');
  for (const rule of prompt.aacRules) lines.push(`- ${rule}`);
  lines.push('', 'GEBRUIKERSCONTEXT:');
  for (const item of prompt.userContext) lines.push(`- ${item.kind}: ${item.value}`);
  lines.push('', 'BEVESTIGDE CONCEPTEN (in volgorde):');
  for (const ref of prompt.chosenConcepts) lines.push(`- ${ref.concept} (${ref.label})`);
  return lines.join('\n');
}
