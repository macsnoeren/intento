import { useEffect, useState, type FormEvent } from 'react';
import type {
  AacSymbol,
  AccountPublic,
  CaregiverConversationView,
  UserPublic,
} from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import { ChangePasswordPanel } from './ChangePasswordPanel.tsx';

/**
 * Begeleiderinterface — **vraagmodus** (T7.1, DESIGN §3.2, §5.2, FR-012).
 *
 * Een begeleider stelt een gekoppelde gebruiker een vraag ("Wat wil je drinken?"). De begeleider kiest:
 *  1. de **gebruiker** (alleen aan hem gekoppelde gebruikers verschijnen — de backend filtert);
 *  2. de letterlijke **vraag**;
 *  3. een **onderwerp** (AAC-topic, bv. "Drinken") waarvan de mogelijke antwoorden komen; via de
 *     AAC-zoekfunctie op te zoeken.
 *
 * Versturen roept `POST /question/start` aan: de vraag verschijnt daarna in de gebruikersapp op de
 * tablet, waar de gebruiker het antwoord zelf samenstelt en bevestigt. De begeleider bevestigt nooit
 * namens de gebruiker (DESIGN §2, §3.3).
 */
export function QuestionModePage({
  api,
  account,
  onLogout,
}: {
  api: Api;
  account: AccountPublic;
  onLogout: () => void;
}): React.JSX.Element {
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [userId, setUserId] = useState('');
  const [question, setQuestion] = useState('');
  const [topicQuery, setTopicQuery] = useState('');
  const [results, setResults] = useState<AacSymbol[]>([]);
  const [anchor, setAnchor] = useState<AacSymbol | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { users: list } = await api.listQuestionUsers();
        if (!active) return;
        setUsers(list);
        if (list.length > 0) setUserId((prev) => prev || list[0]!.id);
      } catch (err) {
        if (active) setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  async function handleSearch(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (topicQuery.trim().length === 0) return;
    try {
      const { symbols } = await api.searchAac(topicQuery.trim());
      setResults(symbols);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Zoeken mislukt.');
    }
  }

  async function handleSend(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSent(null);
    if (!userId || question.trim().length === 0 || !anchor) return;
    setBusy(true);
    try {
      await api.startQuestion({ userId, question: question.trim(), anchorConcept: anchor.concept });
      const target = users.find((u) => u.id === userId);
      setSent(`Vraag verstuurd naar ${target?.name ?? 'de gebruiker'}.`);
      setQuestion('');
      setAnchor(null);
      setTopicQuery('');
      setResults([]);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Versturen mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin">
      <header className="admin__header">
        <h1 className="panel__title">Vraag stellen</h1>
        <div className="admin__account">
          <span>{account.email}</span>
          <button className="button" type="button" onClick={onLogout}>
            Uitloggen
          </button>
        </div>
      </header>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {sent ? (
        <p className="form__ok" role="status">
          {sent}
        </p>
      ) : null}

      {users.length === 0 ? (
        <section className="panel">
          <p className="muted">
            Je bent nog niet aan een gebruiker gekoppeld. Vraag de beheerder je te koppelen.
          </p>
        </section>
      ) : (
        <form className="panel form" aria-label="Vraag stellen" onSubmit={(e) => void handleSend(e)}>
          <label className="field">
            <span className="field__label">Gebruiker</span>
            <select
              className="field__input"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Vraag</span>
            <input
              className="field__input"
              type="text"
              placeholder="Bijvoorbeeld: Wat wil je drinken?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              required
            />
          </label>

          <fieldset className="field">
            <legend className="field__label">Onderwerp (mogelijke antwoorden)</legend>
            <div className="form form--inline" role="group" aria-label="Onderwerp kiezen">
              <input
                className="field__input"
                type="text"
                placeholder="Zoek een onderwerp, bv. drinken"
                aria-label="Onderwerp zoeken"
                value={topicQuery}
                onChange={(e) => setTopicQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleSearch(e);
                  }
                }}
              />
              <button
                className="button"
                type="button"
                onClick={(e) => void handleSearch(e)}
                disabled={topicQuery.trim().length === 0}
              >
                Zoeken
              </button>
            </div>

            {anchor ? (
              <p className="muted">
                Gekozen onderwerp: <strong>{anchor.label}</strong>{' '}
                <button
                  className="button button--link"
                  type="button"
                  onClick={() => setAnchor(null)}
                >
                  wijzigen
                </button>
              </p>
            ) : results.length > 0 ? (
              <ul className="topic-results">
                {results.map((symbol) => (
                  <li key={symbol.id}>
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        setAnchor(symbol);
                        setResults([]);
                      }}
                    >
                      {symbol.glyph} {symbol.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </fieldset>

          <div className="form__actions">
            <button
              className="button button--primary"
              type="submit"
              disabled={busy || !userId || question.trim().length === 0 || !anchor}
            >
              Vraag versturen
            </button>
          </div>
        </form>
      )}

      {userId ? <ConversationWatch api={api} userId={userId} /> : null}

      {/* Eigen wachtwoord wijzigen (T2.5). Een begeleider komt binnen met een tijdelijk wachtwoord
          dat zijn beheerder kent (T2.4); dit is zijn enige weergave, dus staat het paneel hier. */}
      <ChangePasswordPanel api={api} />
    </main>
  );
}

/**
 * Meekijken met het lopende gesprek (T7.2, DESIGN §3.3, §5.2, FR-011). De begeleider ziet **read-only**
 * de gesprekcontext van de gekoppelde gebruiker: of de gebruiker in ondersteuningsmodus staat, een
 * eventuele eigen vraag en het afgelegde pad (broodkruimel). Bewust géén keuze-/bevestigknoppen: kiezen
 * en bevestigen kan uitsluitend de gebruiker zelf op de tablet (server-side afgedwongen). Ophalen gebeurt
 * op verzoek (knop) zodat er geen ongevraagd polling-verkeer loopt; de begeleider ververst zelf.
 */
function ConversationWatch({ api, userId }: { api: Api; userId: string }): React.JSX.Element {
  const [view, setView] = useState<CaregiverConversationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bij het wisselen van gebruiker het oude beeld wissen zodat we nooit context van een andere gebruiker tonen.
  useEffect(() => {
    setView(null);
    setError(null);
  }, [userId]);

  async function refresh(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      setView(await api.viewUserConversation(userId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Meekijken mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Meekijken met het gesprek">
      <div className="form form--inline">
        <h2 className="panel__title">Meekijken met het gesprek</h2>
        <button className="button" type="button" onClick={() => void refresh()} disabled={busy}>
          {view ? 'Verversen' : 'Meekijken'}
        </button>
      </div>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {view ? (
        <>
          {view.supportMode ? (
            <p className="tablet__support" role="note">
              <span aria-hidden="true">🤝 </span>Ondersteuningsmodus actief
            </p>
          ) : null}

          {view.session ? (
            <>
              {view.session.caregiverQuestion ? (
                <p className="muted">
                  Jouw vraag: <strong>{view.session.caregiverQuestion}</strong>
                </p>
              ) : null}

              {view.session.history.length > 0 ? (
                <nav className="breadcrumb" aria-label="Gekozen pad">
                  {view.session.history.map((step) => (
                    <span key={step.order} className="breadcrumb__item">
                      <span aria-hidden="true">{step.symbol.glyph}</span> {step.symbol.label}
                    </span>
                  ))}
                </nav>
              ) : (
                <p className="muted">Er is nog geen keuze gemaakt.</p>
              )}
            </>
          ) : (
            <p className="muted">Er loopt op dit moment geen gesprek.</p>
          )}
        </>
      ) : null}
    </section>
  );
}
