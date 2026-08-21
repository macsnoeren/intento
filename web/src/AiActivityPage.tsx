import { useCallback, useEffect, useState } from 'react';
import type { AccountPublic, AiJobSummary } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import { AdminNav, type AdminView } from './AdminNav.tsx';
import { AiStatusBadge } from './AiStatusBadge.tsx';

/** Verversinterval (ms): rustig genoeg om naast een lopend gesprek open te laten staan. */
const POLL_MS = 5000;

/** Nederlandse naam bij een AI-taak; onbekende taken tonen we onvertaald (eerlijker dan verzinnen). */
const TASK_LABELS: Record<string, string> = {
  select_next_question: 'Volgende vraag kiezen',
  generate_message: 'Boodschap formuleren',
};

/** Menselijke status bij een job uit de wachtrij (T5.5). */
const STATUS_LABELS: Record<AiJobSummary['status'], string> = {
  WAITING_FOR_WORKER: 'Wacht op ruimte',
  QUEUED: 'In de wachtrij',
  CLAIMED: 'Wordt verwerkt',
  SUCCEEDED: 'Klaar',
  FAILED: 'Mislukt',
  EXPIRED: 'Verlopen',
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Beheeromgeving — **AI-activiteit** (T9.15, DESIGN §7.2, §7.4, §9.4).
 *
 * Antwoord op de vraag uit de gebruikerstest: "doet de AI wel opties bedenken, en kan ik zien wat er op
 * de achtergrond gebeurt?" Deze pagina toont de recentste AI-jobs uit de wachtrij: welke taak, hoe het
 * afliep, hoe lang het duurde, welke worker het deed en — bij een geslaagde vraagselectie — de vraag die
 * de AI formuleerde, de concepten die zij aandroeg met hun zekerheid, en haar motivering.
 *
 * Bewust **read-only** en zonder de prompt: in de prompt zit persoonlijke context (T6.1), die hoort niet
 * in een beheerscherm. De server geeft hem dan ook niet terug. De pagina staat achter dezelfde grens als
 * het worker-tokenbeheer (platformbeheer): `AiJob` is infrastructuur en niet tenant-gebonden, dus een
 * gewone organisatie-ADMIN krijgt 403 en hier een uitleg in plaats van de lijst.
 */
export function AiActivityPage({
  api,
  account,
  onLogout,
  onNavigate,
  pollMs = POLL_MS,
}: {
  api: Api;
  account: AccountPublic;
  onLogout: () => void;
  onNavigate: (view: AdminView) => void;
  /** Verversinterval in ms; `0` = alleen handmatig. Tests zetten hem laag i.p.v. echt te wachten. */
  pollMs?: number;
}): React.JSX.Element {
  const [jobs, setJobs] = useState<AiJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { jobs: list } = await api.listAiJobs();
      setJobs(list);
      setForbidden(false);
      setError(null);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'NOT_PLATFORM_ADMIN') {
        setForbidden(true);
      } else {
        setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      }
    } finally {
      setLoading(false);
    }
  }, [api]);

  // Zelf verversen: dit scherm staat naast een lopend gesprek open, dus het moet meebewegen.
  useEffect(() => {
    void refresh();
    if (pollMs <= 0) return;
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  return (
    <main className="admin">
      <header className="admin__header">
        <div>
          <h1 className="panel__title">AI-activiteit</h1>
          <AdminNav active="ai-activity" onNavigate={onNavigate} />
        </div>
        <div className="admin__account">
          <AiStatusBadge api={api} />
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

      {forbidden ? (
        <section className="panel">
          <p>
            De AI-wachtrij is platform-infrastructuur en staat los van jouw organisatie. Alleen een
            platformbeheerder kan hier meekijken.
          </p>
        </section>
      ) : (
        <section className="panel" aria-label="Recente AI-aanvragen">
          <div className="form form--inline">
            <h2 className="panel__subtitle">Recente AI-aanvragen</h2>
            <button className="button" type="button" onClick={() => void refresh()}>
              Nu verversen
            </button>
          </div>
          <p className="muted">
            Elke aanvraag die de backend aan een AI-worker gaf, nieuwste eerst
            {pollMs > 0
              ? `; dit scherm werkt zichzelf elke ${Math.round(pollMs / 1000)} seconden bij`
              : ''}
            . De prompt zelf wordt bewust niet getoond: daar kan persoonlijke context in staan.
          </p>

          {loading ? <p className="muted">Laden…</p> : null}
          {!loading && jobs.length === 0 ? (
            <p className="muted">
              Nog geen AI-aanvragen. Draait de backend op <code>AI_PROVIDER=mock</code>, dan komt er
              niets in de wachtrij — dan rekent de server zelf en denkt er geen AI mee.
            </p>
          ) : null}

          <ul className="ai-jobs">
            {jobs.map((job) => (
              <li key={job.id} className="ai-jobs__item">
                <p className="ai-jobs__head">
                  <strong>{TASK_LABELS[job.task] ?? job.task}</strong> · {STATUS_LABELS[job.status]}{' '}
                  · {formatDuration(job.durationMs)}
                  {job.attempts > 1 ? ` · ${job.attempts} pogingen` : ''}
                  {job.worker ? ` · ${job.worker}` : ''}
                </p>
                <p className="muted">{new Date(job.createdAt).toLocaleString('nl-NL')}</p>

                {job.question ? <p className="ai-jobs__question">“{job.question}”</p> : null}
                {job.options.length > 0 ? (
                  <ul className="ai-jobs__options">
                    {job.options.map((option, index) => (
                      <li key={`${option.concept}-${index}`}>
                        {option.concept}
                        {option.confidence !== null
                          ? ` (${Math.round(option.confidence * 100)}%)`
                          : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {job.reason ? <p className="muted">Reden: {job.reason}</p> : null}
                {job.confidence !== null ? (
                  <p className="muted">Zekerheid: {Math.round(job.confidence * 100)}%</p>
                ) : null}
                {job.error ? <p className="form__error">{job.error}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
