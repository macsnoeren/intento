import { useCallback, useEffect, useState } from 'react';
import type {
  AccountPublic,
  ConversationSummary,
  ConversationTranscriptCorrection,
  ConversationTranscriptResponse,
  UserPublic,
} from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';

/**
 * Beheeromgeving — gespreksverloop (T12.1, DESIGN §3.1, §3.6, §9.1).
 *
 * Kies een gebruiker, kies een gesprek, en lees het van begin tot eind terug: per stap de **gestelde
 * vraag**, de **aangeboden pictogrammen** in de getoonde volgorde en **wat de gebruiker koos**. Dat is
 * precies de reconstructie die na elke gebruikerstest nodig bleek en die tot nu toe alleen uit
 * server-logs te halen was.
 *
 * Deze pagina toont als enige beheerweergave **communicatie-inhoud**. Ze blijft binnen de organisatie:
 * de server filtert op tenant en, voor een begeleider, op gekoppelde gebruikers. De client toont
 * daarom alleen wat hij terugkrijgt en probeert niets te raden — een 403 is hier een geldig antwoord,
 * geen fout die weggepoetst moet worden.
 */

function formatDate(value: string): string {
  return new Date(value).toLocaleString('nl-NL');
}

/** Korte omschrijving van een gesprek in de lijst: waaraan herken je dít gesprek terug? */
function summaryLine(conversation: ConversationSummary): string {
  if (conversation.message) return conversation.message;
  if (conversation.caregiverQuestion) return `Vraag: ${conversation.caregiverQuestion}`;
  return 'Geen bevestigde boodschap';
}

/**
 * Wat er op dit punt gebeurde toen de gebruiker "nee" zei.
 *
 * Drie uitkomsten, en het verschil ertussen is precies wat een begeleider hier wil zien. Bij ❌ Nee rolt
 * de laatste keuze terug; bij "Staat er niet bij" verdwijnt het hele aanbod van dat punt. Een
 * **verfijnronde** (T12.3) doet géén van beide: de gebruiker drukte ❌, en de AI probeerde eerst dezelfde
 * route preciezer te maken zonder hem iets af te nemen. Dat expliciet benoemen voorkomt de indruk dat de
 * AI daar spontaan van vraag veranderde.
 */
function correctionLabel(correction: ConversationTranscriptCorrection): string {
  switch (correction.type) {
    case 'refine_round':
      return '❌ Nee — de AI ging eerst verfijnen; niets teruggerold of uitgesloten';
    case 'no_fitting_option':
      return `🤷 Staat er niet bij — ${correction.rejectedConcept ?? 'aanbod'} overgeslagen`;
    default:
      return `❌ Nee — ${correction.rejectedConcept ?? 'keuze'} teruggerold`;
  }
}

/** Eén aangeboden pictogram in de terugblik; de keuze van de gebruiker is gemarkeerd. */
function OptionChip({
  option,
}: {
  option: ConversationTranscriptResponse['steps'][number]['options'][number];
}): React.JSX.Element {
  return (
    <li className={`transcript__option${option.chosen ? ' transcript__option--chosen' : ''}`}>
      <span aria-hidden="true">{option.glyph}</span>
      <span>{option.label}</span>
      {option.isNew ? <span className="badge">nieuw woord</span> : null}
      {option.missing ? <span className="badge badge--warn">verwijderd</span> : null}
      {option.chosen ? <span className="visually-hidden">— gekozen door de gebruiker</span> : null}
    </li>
  );
}

export function ConversationsPage({
  api,
  account,
  onLogout,
  onNavigate,
}: {
  api: Api;
  account: AccountPublic;
  onLogout: () => void;
  onNavigate: (view: AdminView) => void;
}): React.JSX.Element {
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [userId, setUserId] = useState<string>('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [transcript, setTranscript] = useState<ConversationTranscriptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { users: list } = await api.listUsers();
        if (cancelled) return;
        setUsers(list);
        // Meteen de eerste gebruiker openen: met één gebruiker (het gewone geval) scheelt dat een klik.
        setUserId((current) => current || (list[0]?.id ?? ''));
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const loadConversations = useCallback(
    async (id: string) => {
      setError(null);
      setTranscript(null);
      if (!id) {
        setConversations([]);
        return;
      }
      try {
        const { conversations: list } = await api.listConversations(id);
        setConversations(list);
      } catch (err) {
        setConversations([]);
        setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      }
    },
    [api],
  );

  useEffect(() => {
    void loadConversations(userId);
  }, [userId, loadConversations]);

  async function openConversation(id: string): Promise<void> {
    setError(null);
    try {
      setTranscript(await api.getConversation(id));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Gesprek laden mislukt.');
    }
  }

  return (
    <AppShell
      account={account}
      title="Gesprekken"
      subtitle="Per stap: de gestelde vraag, de aangeboden pictogrammen en wat de gebruiker koos."
      active="conversations"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="muted">Laden…</p>
      ) : users.length === 0 ? (
        <p className="muted">Er zijn nog geen gebruikers.</p>
      ) : (
        <>
          <section className="panel" aria-label="Gebruiker kiezen">
            <label className="field">
              <span className="field__label">Gebruiker</span>
              <select
                className="field__input"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="panel" aria-label="Gesprekken">
            {conversations.length === 0 ? (
              <p className="muted">Deze gebruiker heeft nog geen gesprekken gevoerd.</p>
            ) : (
              <ul className="activity-list">
                {conversations.map((conversation) => (
                  <li key={conversation.id} className="activity-list__item">
                    <button
                      type="button"
                      className="button"
                      aria-current={transcript?.id === conversation.id ? 'true' : undefined}
                      onClick={() => void openConversation(conversation.id)}
                    >
                      Bekijk
                    </button>
                    <span className="activity-list__user">{summaryLine(conversation)}</span>
                    {conversation.mode === 'question' ? (
                      <span className="badge">vraagmodus</span>
                    ) : null}
                    <span className="muted">
                      {conversation.stepCount} stappen
                      {conversation.correctionCount > 0
                        ? ` · ${conversation.correctionCount}× gecorrigeerd`
                        : ''}
                    </span>
                    <span className="muted">{formatDate(conversation.startedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {transcript ? (
        <section className="panel" aria-label="Gespreksverloop">
          <h2 className="panel__subtitle">Verloop</h2>
          <p className="muted">
            {formatDate(transcript.startedAt)}
            {transcript.strategy ? ` · aanpak: ${transcript.strategy.label}` : ''}
          </p>
          {transcript.caregiverQuestion ? (
            <p>
              <strong>De begeleider vroeg:</strong> {transcript.caregiverQuestion}
            </p>
          ) : null}

          <ol className="transcript">
            {transcript.steps.map((step) => (
              <li key={step.order} className="transcript__step">
                <p className="transcript__question">{step.question}</p>
                <ul className="transcript__options">
                  {step.options.map((option) => (
                    <OptionChip key={option.concept} option={option} />
                  ))}
                </ul>
                {transcript.corrections
                  .filter((correction) => correction.stepOrder === step.order)
                  .map((correction) => (
                    <p key={`${correction.stepOrder}-${correction.at}`} className="muted">
                      {correctionLabel(correction)}
                    </p>
                  ))}
              </li>
            ))}
          </ol>

          <p>
            <strong>Boodschap:</strong>{' '}
            {transcript.message ?? <span className="muted">niet bevestigd</span>}
          </p>
        </section>
      ) : null}
    </AppShell>
  );
}
