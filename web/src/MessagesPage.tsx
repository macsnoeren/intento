import { useCallback, useEffect, useState } from 'react';
import type { AccountPublic, MessageListResponse, MessagePublic } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';

/**
 * Berichten (N11.6, INTENTO-NEW-DESIGN §32, §49): alle bevestigde berichten van de organisatie, nieuwste
 * eerst. Per bericht wanneer, van wie, de boodschap en aan wie het verstuurd is — of "niet verstuurd".
 * Alleen voor de beheerder; elke opvraging wordt vastgelegd in de audit-log.
 */

const PAGE_SIZE = 25;

function when(iso: string): string {
  return new Date(iso).toLocaleString('nl-NL', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "Verstuurd aan Mama", "Niet gelukt: Tim", of "Niet verstuurd". */
export function deliverySummary(message: MessagePublic): string {
  if (message.deliveries.length === 0) return 'Niet verstuurd';
  return message.deliveries
    .map((delivery) => {
      const name = delivery.contactName ?? 'een verwijderd contact';
      if (delivery.status === 'sent') return `Verstuurd aan ${name}`;
      if (delivery.status === 'failed') return `Niet gelukt: ${name}`;
      return `Bezig met versturen aan ${name}`;
    })
    .join(' · ');
}

export function MessagesPage({
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
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MessageListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.listMessages({ page, pageSize: PAGE_SIZE }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    } finally {
      setLoading(false);
    }
  }, [api, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <AppShell
      account={account}
      title="Berichten"
      subtitle="De bevestigde berichten van je organisatie: van wie, wat, en aan wie verstuurd."
      active="messages"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="panel" aria-label="Berichten">
        {data === null ? (
          <p className="muted">Laden…</p>
        ) : data.items.length === 0 ? (
          <p className="muted">Nog geen bevestigde berichten.</p>
        ) : (
          <>
            <p className="muted" role="status">
              {data.total === 1 ? '1 bericht' : `${data.total} berichten`}
            </p>
            <ul className="item-list">
              {data.items.map((message) => (
                <li
                  key={message.id}
                  className="item-row"
                  aria-label={`Bericht van ${message.user.name}`}
                >
                  <div className="record__body">
                    <span className="record__meta">
                      {message.user.name} · {when(message.confirmedAt)}
                    </span>
                    <span className="record__title">"{message.message}"</span>
                    <span className="record__meta">{deliverySummary(message)}</span>
                  </div>
                </li>
              ))}
            </ul>
            {pages > 1 ? (
              <nav className="pager" aria-label="Pagina's">
                <button
                  className="button"
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Vorige
                </button>
                <span className="muted">
                  Pagina {data.page} van {pages}
                </span>
                <button
                  className="button"
                  type="button"
                  disabled={page >= pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Volgende
                </button>
              </nav>
            ) : null}
          </>
        )}
      </section>
    </AppShell>
  );
}
