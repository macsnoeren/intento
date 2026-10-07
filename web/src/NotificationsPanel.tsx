import { useEffect, useState } from 'react';
import type { AccountNotifications, AccountNotificationsUpdate } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Meldingen van de beheerder: een e-mail per nieuw ontbrekend woord (N9.3, §17; één per woord, niet per
 * keer dat het voorkomt) en een kopie van elk verstuurd bericht, met de ontvanger erbij (N11.7, §32).
 * Allebei standaard uit.
 */
export function NotificationsPanel({ api }: { api: Api }): React.JSX.Element {
  const [settings, setSettings] = useState<AccountNotifications | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getAccountNotifications()
      .then((loaded) => {
        if (active) setSettings(loaded);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      });
    return () => {
      active = false;
    };
  }, [api]);

  async function change(next: AccountNotificationsUpdate): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setSettings(await api.updateAccountNotifications(next));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Opslaan mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Meldingen">
      <h2 className="panel__subtitle">Meldingen</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings?.notifyGapsByEmail ?? false}
          disabled={settings === null || busy}
          onChange={(e) => void change({ notifyGapsByEmail: e.target.checked })}
        />
        <span>E-mail bij een nieuw ontbrekend woord</span>
      </label>
      <p className="muted">
        Eén e-mail per woord dat voor het eerst ontbreekt, niet elke keer dat het voorkomt. Je ziet
        de open woorden ook altijd bij "Ontbrekende woorden" in het menu.
      </p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings?.copySentMessages ?? false}
          disabled={settings === null || busy}
          onChange={(e) => void change({ copySentMessages: e.target.checked })}
        />
        <span>Kopie van verstuurde berichten</span>
      </label>
      <p className="muted">
        Van elk bericht dat iemand in je organisatie verstuurt, krijg je een kopie met de ontvanger
        erbij. Alle berichten staan ook onder "Berichten".
      </p>
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
