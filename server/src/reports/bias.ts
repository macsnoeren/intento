import { z } from 'zod';
import type { BiasReport, BiasShare } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Encryptor } from '../crypto/encryption.js';
import { storedOptionSchema, type StoredOption } from '../communication/provenance.js';

/**
 * Het bias-rapport (N14.3, INTENTO-NEW-DESIGN §24 B4/B5, §25).
 *
 * Alles komt uit wat er werkelijk getoond werd (Presented), wat de gebruiker deed (Observed) en de
 * zekerheid die de agents zelf opgaven (Inferred) — binnen de bewaartermijn, per organisatie. Het rapport
 * oordeelt niet; het laat zien hoe sterk de plek en de vorm de keuzes kunnen sturen:
 *
 * - **Eerste plek** (B4): van de keuzes uit tegels, het aandeel op plek 1, naast wat je bij toeval zou
 *   verwachten (gemiddeld 1 / aantal tegels).
 * - **JA in ja/nee** (B4): wie moeite heeft met kiezen, zegt vaker JA op wat er staat (§25).
 * - **Contacten** (B4): per contact hoe vaak gekozen (JA op versturen naar dát contact), en hoe vaak het
 *   toen het eerst aangeboden contact was.
 * - **Vormwisselingen** (B4) bij "AI kiest": inferences `mode_change` na de start.
 * - **Ontbrekende woorden** (B4).
 * - **Overconfidence** (B5): een "Bedoel je …?" met zekerheid ≥ 0,9 waarop NEE kwam, en een stijging van
 *   de beste hypothese met ≥ 0,4 in één beurt terwijl de gebruiker daartussen geen JA gaf en niets koos.
 */

export const CONFIDENT = 0.9;
export const SUDDEN_RISE = 0.4;

export interface BiasScreen {
  sessionId: string;
  turn: number;
  kind: string;
  mode: string;
  options: StoredOption[];
}
export interface BiasObserved {
  sessionId: string;
  turn: number;
  type: string;
  position: number | null;
}
export interface BiasInference {
  sessionId: string;
  turn: number;
  kind: string;
  confidence: number | null;
}

type Counted = Omit<BiasReport, 'gaps' | 'contacts'> & {
  contacts: { contactId: string; chosen: number; chosenAtFirst: number }[];
};

function share(count: number, of: number): BiasShare {
  return { count, of, share: of > 0 ? count / of : null };
}

const CONTACT_SCREENS = new Set(['share_contact', 'confirm_send']);
const POSITIVE = new Set(['answer_yes', 'select_option']);

/** De getallen uit de ruwe provenance. Puur: geen database, geen klok. */
export function computeBias(
  screens: BiasScreen[],
  observed: BiasObserved[],
  inferences: BiasInference[],
): Counted {
  const key = (sessionId: string, turn: number) => `${sessionId}:${turn}`;
  // Het antwoord per scherm (het eerste: een scherm wordt hooguit één keer beantwoord).
  const answers = new Map<string, BiasObserved>();
  for (const event of observed) {
    if (event.type === 'start' || event.type === 'stop') continue;
    const k = key(event.sessionId, event.turn);
    if (!answers.has(k)) answers.set(k, event);
  }
  const sessions = new Set(screens.map((s) => s.sessionId));

  let tileChoices = 0;
  let tileFirst = 0;
  let expectedSum = 0;
  let binaryAnswers = 0;
  let binaryYes = 0;
  const offered = new Map<string, string[]>(); // per gesprek de contacten in volgorde van aanbieden
  const chosenContacts = new Map<string, Set<string>>(); // per gesprek: JA op versturen
  const sorted = [...screens].sort((a, b) =>
    a.sessionId === b.sessionId ? a.turn - b.turn : a.sessionId < b.sessionId ? -1 : 1,
  );

  for (const screen of sorted) {
    const answer = answers.get(key(screen.sessionId, screen.turn));
    if (screen.kind === 'question' && screen.mode === 'multi' && answer?.type === 'select_option') {
      tileChoices += 1;
      if (answer.position === 0) tileFirst += 1;
      expectedSum += screen.options.length > 0 ? 1 / screen.options.length : 0;
    }
    if (
      screen.kind === 'question' &&
      screen.mode === 'binary' &&
      (answer?.type === 'answer_yes' || answer?.type === 'answer_no')
    ) {
      binaryAnswers += 1;
      if (answer.type === 'answer_yes') binaryYes += 1;
    }
    if (CONTACT_SCREENS.has(screen.kind)) {
      const list = offered.get(screen.sessionId) ?? [];
      const contacts = screen.options.filter((o) => o.kind === 'contact' && o.contactId);
      for (const option of contacts) {
        if (option.contactId && !list.includes(option.contactId)) list.push(option.contactId);
      }
      offered.set(screen.sessionId, list);
      const only = contacts.length === 1 ? contacts[0]?.contactId : undefined;
      if (answer?.type === 'answer_yes' && only) {
        const set = chosenContacts.get(screen.sessionId) ?? new Set<string>();
        set.add(only);
        chosenContacts.set(screen.sessionId, set);
      }
    }
  }

  const perContact = new Map<string, { chosen: number; chosenAtFirst: number }>();
  let contactChoices = 0;
  let contactFirst = 0;
  for (const [sessionId, chosen] of chosenContacts) {
    const first = offered.get(sessionId)?.[0];
    for (const contactId of chosen) {
      const row = perContact.get(contactId) ?? { chosen: 0, chosenAtFirst: 0 };
      row.chosen += 1;
      contactChoices += 1;
      if (contactId === first) {
        row.chosenAtFirst += 1;
        contactFirst += 1;
      }
      perContact.set(contactId, row);
    }
  }

  // Vormwisselingen: elke mode_change na de startbeurt.
  const starts = new Map<string, number>();
  for (const screen of screens) {
    starts.set(
      screen.sessionId,
      Math.min(starts.get(screen.sessionId) ?? screen.turn, screen.turn),
    );
  }
  const switched = new Set<string>();
  let switches = 0;
  for (const inference of inferences) {
    if (inference.kind !== 'mode_change') continue;
    if (inference.turn > (starts.get(inference.sessionId) ?? 0)) {
      switches += 1;
      switched.add(inference.sessionId);
    }
  }

  // Overconfidence (B5).
  let confident = 0;
  let confidentRejected = 0;
  for (const inference of inferences) {
    if (inference.kind !== 'proposal' || (inference.confidence ?? 0) < CONFIDENT) continue;
    confident += 1;
    if (answers.get(key(inference.sessionId, inference.turn))?.type === 'answer_no') {
      confidentRejected += 1;
    }
  }
  let suddenRises = 0;
  const bySession = new Map<string, BiasInference[]>();
  for (const inference of inferences) {
    if (inference.kind !== 'intent_hypotheses' || inference.confidence === null) continue;
    const list = bySession.get(inference.sessionId) ?? [];
    list.push(inference);
    bySession.set(inference.sessionId, list);
  }
  for (const list of bySession.values()) {
    list.sort((a, b) => a.turn - b.turn);
    for (let i = 1; i < list.length; i += 1) {
      const before = list[i - 1];
      const after = list[i];
      if (!before || !after || before.confidence === null || after.confidence === null) continue;
      if (after.confidence - before.confidence < SUDDEN_RISE) continue;
      const answer = answers.get(key(before.sessionId, before.turn));
      if (!answer || !POSITIVE.has(answer.type)) suddenRises += 1;
    }
  }

  return {
    sessions: sessions.size,
    firstPosition: {
      ...share(tileFirst, tileChoices),
      expected: tileChoices > 0 ? expectedSum / tileChoices : null,
    },
    binaryYes: share(binaryYes, binaryAnswers),
    contacts: [...perContact.entries()]
      .map(([contactId, row]) => ({ contactId, ...row }))
      .sort((a, b) => b.chosen - a.chosen || a.contactId.localeCompare(b.contactId)),
    contactFirst: share(contactFirst, contactChoices),
    modeSwitches: { switches, sessions: switched.size },
    overconfidence: {
      rejectedConfidentProposals: share(confidentRejected, confident),
      suddenRises,
    },
  };
}

const optionsSchema = z.array(storedOptionSchema);

/** Laadt de provenance van de organisatie (of één gebruiker) en rekent het rapport uit. */
export async function biasReport(
  prisma: PrismaClient,
  encryptor: Encryptor,
  scope: { organizationId: string; userId?: string; since?: Date },
): Promise<BiasReport> {
  const session = {
    organizationId: scope.organizationId,
    ...(scope.userId ? { userId: scope.userId } : {}),
    ...(scope.since ? { startedAt: { gte: scope.since } } : {}),
  };
  const where = { session };
  const [screens, observed, inferences, gaps, openGaps] = await Promise.all([
    prisma.presentationEvent.findMany({
      where,
      select: { sessionId: true, turn: true, kind: true, mode: true, optionsJson: true },
    }),
    prisma.observedEvent.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      select: { sessionId: true, turn: true, type: true, position: true },
    }),
    prisma.inference.findMany({
      where: { ...where, kind: { in: ['mode_change', 'proposal', 'intent_hypotheses'] } },
      select: { sessionId: true, turn: true, kind: true, confidence: true },
    }),
    prisma.vocabularyGap.count({ where: { organizationId: scope.organizationId } }),
    prisma.vocabularyGap.count({ where: { organizationId: scope.organizationId, status: 'open' } }),
  ]);
  const counted = computeBias(
    screens.map(({ optionsJson, ...screen }) => ({
      ...screen,
      options: optionsSchema.parse(optionsJson),
    })),
    observed,
    inferences,
  );
  const names = new Map(
    (
      await prisma.contact.findMany({
        where: {
          organizationId: scope.organizationId,
          id: { in: counted.contacts.map((c) => c.contactId) },
        },
        select: { id: true, nameEncrypted: true },
      })
    ).map((contact) => [contact.id, encryptor.decrypt(contact.nameEncrypted)]),
  );
  return {
    ...counted,
    contacts: counted.contacts.map((row) => ({ ...row, name: names.get(row.contactId) ?? null })),
    gaps: { open: openGaps, total: gaps },
  };
}
