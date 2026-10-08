import type { StoredOption } from '../communication/provenance.js';

/**
 * De tellingen van één afgerond gesprek (N12.1, INTENTO-NEW-DESIGN §21 laag 1, §22, §25).
 *
 * Puur uit **Presented** (wat er op het scherm stond, met de plek van elke optie) en **Observed** (wat de
 * gebruiker deed) — nooit uit wat een agent concludeerde. Drie soorten:
 *
 * - **symbol** (per Vocabulary-item): per vraagscherm waarop het stond `presented`; `chosen` als de
 *   gebruiker het koos (een tegel, of JA op de binary vraag); `chosenAtFirstPosition` als het daarbij op
 *   plek 0 stond. In binary staat elk symbool op plek 0: elke JA telt daar, en dat is precies het
 *   ja-zeggen dat het bias-rapport moet kunnen laten zien (§25).
 * - **contact** (per contact, één keer per gesprek): `presented` als het werd aangeboden (contactvraag of
 *   tegel); `chosen` als de gebruiker JA zei op het versturen naar dát contact (I3); `chosenAtFirstPosition`
 *   als het ook het eerst aangeboden contact van dit gesprek was.
 * - **mode** (`binary`/`multi`): `presented` per vorm waarin vragen gesteld werden; `chosen` als het gesprek
 *   tot een bevestigde boodschap leidde, voor de vorm van de laatste vraag daarvóór.
 */

export const EXPERIENCE_SUBJECTS = ['symbol', 'contact', 'mode'] as const;
export type ExperienceSubject = (typeof EXPERIENCE_SUBJECTS)[number];

export interface ExperienceTally {
  subjectType: ExperienceSubject;
  subjectRef: string;
  presented: number;
  chosen: number;
  chosenAtFirstPosition: number;
}

export interface TallyScreen {
  turn: number;
  kind: string;
  mode: string;
  options: StoredOption[];
}

export interface TallyObserved {
  turn: number;
  type: string;
  optionRef: string | null;
}

const CONTACT_SCREENS = new Set(['share_contact', 'confirm_send']);

export function tallySession(
  screens: TallyScreen[],
  observed: TallyObserved[],
  confirmed: boolean,
): ExperienceTally[] {
  const sorted = [...screens].sort((a, b) => a.turn - b.turn);
  /** Het antwoord (JA of een keuze) per beurt; een beurt wordt hooguit één keer beantwoord. */
  const answers = new Map<number, TallyObserved>();
  for (const event of observed) {
    if (event.type === 'answer_yes' || event.type === 'select_option') {
      if (!answers.has(event.turn)) answers.set(event.turn, event);
    }
  }
  const tallies = new Map<string, ExperienceTally>();
  const bump = (
    subjectType: ExperienceSubject,
    subjectRef: string,
    field: 'presented' | 'chosen' | 'chosenAtFirstPosition',
  ): void => {
    const key = `${subjectType}:${subjectRef}`;
    const tally = tallies.get(key) ?? {
      subjectType,
      subjectRef,
      presented: 0,
      chosen: 0,
      chosenAtFirstPosition: 0,
    };
    tally[field] += 1;
    tallies.set(key, tally);
  };

  const contactsOffered: string[] = [];
  const contactsChosen = new Set<string>();
  const modes = new Set<string>();

  for (const screen of sorted) {
    const answer = answers.get(screen.turn);
    const chosen = answer ? screen.options.find((option) => option.ref === answer.optionRef) : null;

    if (screen.kind === 'question') {
      modes.add(screen.mode);
      for (const option of screen.options) {
        if (option.kind !== 'symbol' || !option.vocabularyItemId) continue;
        bump('symbol', option.vocabularyItemId, 'presented');
      }
      if (chosen?.kind === 'symbol' && chosen.vocabularyItemId) {
        bump('symbol', chosen.vocabularyItemId, 'chosen');
        if (chosen.position === 0) bump('symbol', chosen.vocabularyItemId, 'chosenAtFirstPosition');
      }
    }

    if (CONTACT_SCREENS.has(screen.kind)) {
      const contacts = screen.options.filter((option) => option.kind === 'contact');
      for (const option of contacts) {
        if (option.contactId && !contactsOffered.includes(option.contactId)) {
          contactsOffered.push(option.contactId);
        }
      }
      // Alleen een JA op een scherm over precies één contact is "versturen naar dát contact".
      const only = contacts.length === 1 ? contacts[0] : undefined;
      if (answer?.type === 'answer_yes' && only?.contactId) contactsChosen.add(only.contactId);
    }
  }

  for (const contactId of contactsOffered) {
    bump('contact', contactId, 'presented');
    if (!contactsChosen.has(contactId)) continue;
    bump('contact', contactId, 'chosen');
    if (contactsOffered[0] === contactId) bump('contact', contactId, 'chosenAtFirstPosition');
  }

  for (const mode of modes) bump('mode', mode, 'presented');
  if (confirmed) {
    // De laatste JA op "Bedoel je …?" (een eerdere kan met ↩ Terug zijn ingetrokken).
    const confirmTurn = sorted
      .filter(
        (screen) =>
          screen.kind === 'confirm_message' && answers.get(screen.turn)?.type === 'answer_yes',
      )
      .at(-1)?.turn;
    const lastQuestion = sorted
      .filter((screen) => screen.kind === 'question' && (confirmTurn ?? Infinity) > screen.turn)
      .at(-1);
    if (lastQuestion) bump('mode', lastQuestion.mode, 'chosen');
  }

  return [...tallies.values()];
}
