import { useCallback, useEffect, useState } from 'react';
import type { AccountPublic, DashboardResponse } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';

/**
 * Beheeromgeving — dashboard. Een beknopt overzicht van de **eigen organisatie**: aantal gebruikers
 * (totaal/actief) en begeleiders.
 */

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
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
