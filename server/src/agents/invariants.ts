import type { PresentationOption, TurnRequest, TurnResponse } from '@intento/shared';

/**
 * Harde invarianten op elk antwoord van de agentdienst (INTENTO-NEW-DESIGN §52).
 *
 * Dit is de waarborg, niet de prompt: wat hier faalt, komt nooit op het scherm en wordt nooit
 * opgeslagen als toestand. De functie is zuiver: ze kijkt alleen naar wat de backend zelf verstuurde
 * (`request`: de Vocabulary die deze organisatie mag gebruiken, de contacten van déze gebruiker, de
 * instellingen en de vorige toestand) en naar het antwoord. Het antwoord heeft het zod-contract al
 * gepasseerd (`agents/client.ts`).
 *
 * Hier: I1, I4, I5, I6, I7 en het deel van I2 dat op het antwoord zelf te zien is: een "Bedoel je …?"
 * vraagt precies de voorgestelde boodschap, en "Klaar" en de deelschermen ("Wil je dit sturen?", N11)
 * tonen alleen een boodschap die de backend zelf als bevestigd heeft vastgelegd (`checkCompletion`). De Communication Intent zelf maakt de backend
 * alleen na een Observed JA (`communication/intents.ts`). I3 (versturen alleen na een JA op dát
 * contact) volgt in N11.3; I8 zit in het contract (geen velden om iets te wijzigen).
 */

export type InvariantId = 'I1' | 'I2' | 'I4' | 'I5' | 'I6' | 'I7';

export interface InvariantViolation {
  invariant: InvariantId;
  /** Beschrijving voor log en `AgentDecision.reason`; noemt ids en aantallen, nooit labels of tekst. */
  message: string;
}

/** Het antwoord schendt minstens één invariant en wordt verworpen. */
export class InvariantViolationError extends Error {
  constructor(readonly violations: InvariantViolation[]) {
    super(violations.map((v) => `${v.invariant}: ${v.message}`).join('; '));
    this.name = 'InvariantViolationError';
  }
}

/** Presentaties waarin de gebruiker uit opties kiest (en waarop I4 van toepassing is). */
const CHOICE_KINDS = new Set(['question', 'share_contact']);
/** De deelfasen van het delen: alleen na een bevestigde boodschap (I2). */
const SHARE_KINDS = new Set(['share_ask', 'share_contact', 'confirm_send']);
/** Alleen in deze deelfasen mag een contact als optie verschijnen. */
const CONTACT_KINDS = new Set(['share_contact', 'confirm_send']);

/** Zo lang blijft de vorm bij "AI kiest" minstens staan (§14). */
export const MIN_TURNS_BEFORE_MODE_SWITCH = 3;

/**
 * De schermtekst bij een voorgestelde boodschap: "Bedoel je: {boodschap}?". Een punt of uitroepteken aan
 * het eind van de boodschap valt weg ("Ik heb pijn." → "Bedoel je: Ik heb pijn?").
 */
export function proposalText(message: string): string {
  return `Bedoel je: ${message.trim().replace(/[.!?]+$/, '')}?`;
}

function normalize(text: string): string {
  return text.trim().toLocaleLowerCase('nl');
}

/** I1: elke optie verwijst naar iets wat deze gebruiker in deze organisatie mag zien. */
function checkReferences(request: TurnRequest, response: TurnResponse): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const items = new Map(request.vocabulary.map((entry) => [entry.id, entry]));
  const contacts = new Map(request.contacts.map((contact) => [contact.id, contact]));
  const { presentation } = response;

  presentation.options.forEach((option, index) => {
    const at = `optie ${index} (${option.ref})`;
    if (option.kind === 'symbol') {
      if (option.contact_id) {
        violations.push({ invariant: 'I1', message: `${at}: een symbool heeft geen contact` });
      }
      const item = option.vocabulary_item_id ? items.get(option.vocabulary_item_id) : undefined;
      if (!item) {
        violations.push({
          invariant: 'I1',
          message: `${at}: symbool ${option.vocabulary_item_id ?? '(geen)'} staat niet in de Vocabulary`,
        });
        return;
      }
      // Een exact symbool draagt zijn eigen betekenis: concept en woord van het item. Een ander woord bij
      // dit pictogram is een stand-in en hoort als zodanig gemarkeerd (§17); stilzwijgend mag het niet.
      if (option.representation === 'exact') {
        if (option.concept && !item.concepts.includes(option.concept)) {
          violations.push({
            invariant: 'I1',
            message: `${at}: concept ${option.concept} hoort niet bij symbool ${item.id}`,
          });
        }
        if (!item.labels.some((label) => normalize(label) === normalize(option.label))) {
          violations.push({
            invariant: 'I1',
            message: `${at}: het woord hoort niet bij symbool ${item.id} (dan is het een stand-in)`,
          });
        }
      }
      return;
    }

    // Contact
    if (!CONTACT_KINDS.has(presentation.kind)) {
      violations.push({
        invariant: 'I1',
        message: `${at}: een contact buiten een deelfase (${presentation.kind})`,
      });
    }
    const contact = option.contact_id ? contacts.get(option.contact_id) : undefined;
    if (!contact) {
      violations.push({
        invariant: 'I1',
        message: `${at}: contact ${option.contact_id ?? '(geen)'} is geen contact van deze gebruiker`,
      });
      return;
    }
    if (
      option.vocabulary_item_id &&
      option.vocabulary_item_id !== contact.vocabulary_item_id &&
      !items.has(option.vocabulary_item_id)
    ) {
      violations.push({
        invariant: 'I1',
        message: `${at}: afbeelding ${option.vocabulary_item_id} staat niet in de Vocabulary`,
      });
    }
  });

  response.gaps.forEach((gap, index) => {
    if (gap.best_available_item_id && !items.has(gap.best_available_item_id)) {
      violations.push({
        invariant: 'I1',
        message: `gap ${index}: pictogram ${gap.best_available_item_id} staat niet in de Vocabulary`,
      });
    }
  });
  return violations;
}

/** I4: Binary precies één optie; Multi-icon 2 tot het ingestelde aantal, allemaal verschillend. */
function checkOptionCount(request: TurnRequest, response: TurnResponse): InvariantViolation[] {
  const { presentation } = response;
  const violations: InvariantViolation[] = [];
  const options = presentation.options;

  const refs = new Set(options.map((option) => option.ref));
  if (refs.size !== options.length) {
    violations.push({ invariant: 'I4', message: 'twee opties met dezelfde ref' });
  }
  const positions = options.map((option) => option.position).sort((a, b) => a - b);
  if (positions.some((position, index) => position !== index)) {
    violations.push({ invariant: 'I4', message: 'posities zijn niet 0…n-1' });
  }

  if (!CHOICE_KINDS.has(presentation.kind)) return violations;

  if (presentation.mode === 'binary') {
    if (options.length !== 1) {
      violations.push({
        invariant: 'I4',
        message: `binary vraagt precies één optie, kreeg ${options.length}`,
      });
    }
    return violations;
  }

  const max = request.settings.options_per_screen;
  if (options.length < 2 || options.length > max) {
    violations.push({
      invariant: 'I4',
      message: `multi-icon vraagt 2 tot ${max} opties, kreeg ${options.length}`,
    });
  }
  const targets = new Set(options.map(optionTarget));
  if (targets.size !== options.length) {
    violations.push({ invariant: 'I4', message: 'twee opties tonen hetzelfde' });
  }
  return violations;
}

/** Wat een optie "is": hetzelfde symbool met hetzelfde woord, of hetzelfde contact. */
function optionTarget(option: PresentationOption): string {
  return option.kind === 'contact'
    ? `contact:${option.contact_id ?? ''}`
    : `symbol:${option.vocabulary_item_id ?? ''}:${normalize(option.label)}`;
}

/** I5: een stand-in kan alleen samen met een gap in hetzelfde antwoord. */
function checkStandIns(response: TurnResponse): InvariantViolation[] {
  return response.presentation.options
    .filter((option) => option.representation === 'stand_in')
    .filter(
      (option) =>
        !response.gaps.some(
          (gap) =>
            gap.best_available_item_id === option.vocabulary_item_id &&
            (option.concept == null || gap.concept === option.concept),
        ),
    )
    .map((option) => ({
      invariant: 'I5' as const,
      message: `stand-in ${option.ref} zonder bijbehorende gap`,
    }));
}

/** I2 (deel): een "Bedoel je …?" vraagt precies de boodschap die bevestigd zou worden. */
function checkProposalText(response: TurnResponse): InvariantViolation[] {
  const { presentation } = response;
  if (presentation.kind !== 'confirm_message') return [];
  if (!presentation.message) {
    return [{ invariant: 'I2', message: '"Bedoel je …?" zonder boodschap' }];
  }
  return presentation.text === proposalText(presentation.message)
    ? []
    : [{ invariant: 'I2', message: 'schermtekst is niet "Bedoel je: {boodschap}?"' }];
}

/**
 * I2 (deel): "Klaar" toont alleen de boodschap die de backend als bevestigd heeft vastgelegd. Een agent
 * die zelf besluit dat het gesprek klaar is, of een andere boodschap toont, wordt verworpen.
 */
export function checkCompletion(
  response: TurnResponse,
  confirmedMessage: string | null,
): InvariantViolation[] {
  if (SHARE_KINDS.has(response.presentation.kind)) {
    // Delen kan alleen een boodschap die de gebruiker zelf bevestigde (§31), en dan precies die.
    if (confirmedMessage === null) {
      return [{ invariant: 'I2', message: 'delen zonder bevestigde boodschap' }];
    }
    return response.presentation.message === confirmedMessage
      ? []
      : [{ invariant: 'I2', message: 'delen met een andere boodschap dan bevestigd' }];
  }
  if (response.presentation.kind !== 'done') return [];
  if (confirmedMessage === null) {
    return [{ invariant: 'I2', message: '"Klaar" zonder bevestigde boodschap' }];
  }
  return response.presentation.message === confirmedMessage
    ? []
    : [{ invariant: 'I2', message: '"Klaar" met een andere boodschap dan bevestigd' }];
}

/** I6: geen "Bedoel je …?" zonder minstens één antwoord van de gebruiker. */
function checkProposalAfterAnswer(
  request: TurnRequest,
  response: TurnResponse,
): InvariantViolation[] {
  if (response.presentation.kind !== 'confirm_message') return [];
  // De backend weet zelf wat de gebruiker deed: de gebeurtenis van déze beurt is een antwoord, of er
  // stond al een antwoord in de toestand die hij meestuurde. Wat de agent in zijn state zet, telt niet.
  const answered = request.event.type !== 'start' || (request.state?.answers.length ?? 0) > 0;
  return answered
    ? []
    : [{ invariant: 'I6', message: '"Bedoel je …?" zonder antwoord van de gebruiker' }];
}

/** I7: een ingestelde vorm wisselt nooit; bij "AI kiest" niet binnen 3 beurten na de vorige wissel. */
function checkModeSwitch(request: TurnRequest, response: TurnResponse): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const setting = request.settings.interaction_mode;
  const next = response.state;
  const { presentation } = response;

  if (CHOICE_KINDS.has(presentation.kind) && presentation.mode !== next.interaction_mode) {
    violations.push({
      invariant: 'I7',
      message: `scherm in ${presentation.mode}, gesprek in ${next.interaction_mode}`,
    });
  }

  if (setting !== 'ai') {
    if (next.interaction_mode !== setting) {
      violations.push({
        invariant: 'I7',
        message: `ingesteld op ${setting}, agent koos ${next.interaction_mode}`,
      });
    }
    return violations;
  }

  const previous = request.state;
  if (!previous || request.event.type === 'start') return violations; // begin: vrije keuze (§14)

  if (next.interaction_mode === previous.interaction_mode) {
    if (next.mode_since_turn !== previous.mode_since_turn) {
      violations.push({
        invariant: 'I7',
        message: 'mode_since_turn veranderd zonder wissel',
      });
    }
    return violations;
  }
  const turnsInMode = request.turn - previous.mode_since_turn;
  if (turnsInMode < MIN_TURNS_BEFORE_MODE_SWITCH) {
    violations.push({
      invariant: 'I7',
      message: `wissel na ${turnsInMode} beurten, minimaal ${MIN_TURNS_BEFORE_MODE_SWITCH}`,
    });
  }
  if (next.mode_since_turn !== request.turn) {
    violations.push({ invariant: 'I7', message: 'na een wissel hoort mode_since_turn deze beurt' });
  }
  return violations;
}

/** Alle schendingen (leeg = in orde). */
export function checkTurnResponse(
  request: TurnRequest,
  response: TurnResponse,
): InvariantViolation[] {
  return [
    ...checkReferences(request, response),
    ...checkOptionCount(request, response),
    ...checkStandIns(response),
    ...checkProposalText(response),
    ...checkProposalAfterAnswer(request, response),
    ...checkModeSwitch(request, response),
  ];
}

/** Gooit `InvariantViolationError` bij minstens één schending. */
export function assertTurnResponse(request: TurnRequest, response: TurnResponse): void {
  const violations = checkTurnResponse(request, response);
  if (violations.length > 0) throw new InvariantViolationError(violations);
}
