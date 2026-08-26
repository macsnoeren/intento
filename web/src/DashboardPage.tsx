import { useCallback, useEffect, useState } from 'react';
import type { AccountPublic, DashboardResponse } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';

/**
 * Beheeromgeving — dashboard (T7.3, DESIGN §5.2, FR-016). Een beknopt overzicht van de **eigen
 * organisatie**: aantal gebruikers (totaal/actief), begeleiders, openstaande AI-conceptvoorstellen
 * (platformbreed) en recente gespreksactiviteit. Bewust **zonder communicatie-inhoud** (privacy by
 * design, DESIGN §6.4): alleen wie/wanneer/status en het aantal bevestigde boodschappen.
 *
 * Vanaf de tegel "openstaande voorstellen" springt de beheerder direct naar de reviewlijst (T7.3).
 */

function statusLabel(status: DashboardResponse['recentActivity'][number]['status']): string {
  switch (status) {
    case 'ACTIVE':
      return 'Actief';
    case 'COMPLETED':
      return 'Afgerond';
    case 'ABANDONED':
      return 'Afgebroken';
  }
}

function modeLabel(mode: string): string {
  return mode === 'question' ? 'Begeleidersvraag' : 'Vrij gesprek';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('nl-NL');
}

export function DashboardPage({
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
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setData(await api.getDashboard());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AppShell
      account={account}
      title="Dashboard"
      subtitle="Hoe het er in jouw organisatie voor staat."
      active="dashboard"
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
      ) : data ? (
        <>
          <section className="stat-grid" aria-label="Overzicht">
            <div className="stat-tile">
              <span className="stat-tile__value">{data.users.total}</span>
              <span className="stat-tile__label">Gebruikers</span>
              <span className="muted">{data.users.active} actief</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__value">{data.caregivers.total}</span>
              <span className="stat-tile__label">Begeleiders</span>
            </div>
            <button
              type="button"
              className="stat-tile stat-tile--action"
              onClick={() => onNavigate('proposals')}
              aria-label={`${data.pendingProposals} openstaande conceptvoorstellen bekijken`}
            >
              <span className="stat-tile__value">{data.pendingProposals}</span>
              <span className="stat-tile__label">Openstaande voorstellen</span>
              <span className="muted">Bekijken →</span>
            </button>
          </section>

          <section className="panel" aria-label="Recente activiteit">
            <h2 className="panel__subtitle">Recente activiteit</h2>
            {data.recentActivity.length === 0 ? (
              <p className="muted">Nog geen gesprekken.</p>
            ) : (
              <ul className="activity-list">
                {data.recentActivity.map((item) => (
                  <li key={item.sessionId} className="activity-list__item">
                    <span className="activity-list__user">{item.userName}</span>
                    <span className="muted">{modeLabel(item.mode)}</span>
                    <span className="badge">{statusLabel(item.status)}</span>
                    <span className="muted">
                      {item.messageCount} bevestigd · {formatDate(item.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
