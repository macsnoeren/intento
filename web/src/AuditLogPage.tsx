import { useCallback, useEffect, useState } from 'react';
import type { AccountPublic, AuditLogEntry } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';

/**
 * Beheeromgeving — audit-log (T8.2, DESIGN §9.4). Toont het spoor van **gevoelige acties** van de eigen
 * organisatie (login, instellingen, persoonlijke context, export/import, beheer). Bewust **zonder
 * communicatie-inhoud**: alleen wie-wat-wanneer (actie, uitkomst, actor, doelobject). De backend filtert
 * op `organizationId`, dus een beheerder ziet nooit het spoor van een andere organisatie.
 */

/** Menselijke labels per actiesleutel (audit/actions.ts). Onbekende sleutels tonen we ruw. */
const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Ingelogd',
  'auth.logout': 'Uitgelogd',
  'auth.register': 'Organisatie geregistreerd',
  'auth.email_verified': 'E-mail bevestigd',
  'account.create': 'Begeleider-account aangemaakt',
  'user.create': 'Gebruiker aangemaakt',
  'user.delete': 'Gebruiker verwijderd',
  'user.settings.update': 'Instellingen aangepast',
  'caregiver.link': 'Begeleider gekoppeld',
  'caregiver.unlink': 'Begeleider ontkoppeld',
  'device.code.create': 'Koppelcode aangemaakt',
  'context.create': 'Context toegevoegd',
  'context.update': 'Context bewerkt',
  'context.delete': 'Context verwijderd',
  'profile.export': 'Profiel geëxporteerd',
  'profile.import': 'Profiel geïmporteerd',
  'worker_token.create': 'Worker-token aangemaakt',
  'worker_token.revoke': 'Worker-token ingetrokken',
  'concept_proposal.approve': 'Conceptvoorstel goedgekeurd',
  'concept_proposal.reject': 'Conceptvoorstel afgewezen',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('nl-NL');
}

export function AuditLogPage({
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
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { entries: list } = await api.listAuditLogs();
      setEntries(list);
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
      title="Audit-log"
      subtitle="Spoor van gevoelige acties — wie, wat en wanneer, zonder communicatie-inhoud."
      active="audit-logs"
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
      ) : entries.length === 0 ? (
        <p className="muted">Nog geen geregistreerde acties.</p>
      ) : (
        <section className="panel" aria-label="Audit-log">
          <ul className="activity-list">
            {entries.map((entry) => (
              <li key={entry.id} className="activity-list__item">
                <span className="activity-list__user">{actionLabel(entry.action)}</span>
                {entry.outcome === 'failure' ? (
                  <span className="badge badge--warn">Mislukt</span>
                ) : (
                  <span className="badge">Gelukt</span>
                )}
                {entry.targetType ? (
                  <span className="muted">
                    {entry.targetType}
                    {entry.targetId ? ` · ${entry.targetId}` : ''}
                  </span>
                ) : null}
                <span className="muted">{formatDate(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
