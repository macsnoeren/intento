import { useEffect, useState } from 'react';
import type { AccountPublic, AttributionSource } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';
import { AttributionList } from './AttributionList.tsx';

/** Beheeromgeving — "Bronnen": de bronvermelding van de Vocabulary (INTENTO-NEW-DESIGN §15). */
export function AttributionsPage({
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
  const [sources, setSources] = useState<AttributionSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .listAttributions()
      .then((response) => {
        if (active) setSources(response.sources);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      });
    return () => {
      active = false;
    };
  }, [api]);

  return (
    <AppShell
      account={account}
      title="Bronnen"
      subtitle="Van wie de symbolen komen en onder welke licentie."
      active="sources"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {sources ? (
        <AttributionList sources={sources} />
      ) : error ? null : (
        <p className="muted">Laden…</p>
      )}
    </AppShell>
  );
}
