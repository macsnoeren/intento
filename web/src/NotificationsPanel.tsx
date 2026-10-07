import { useEffect, useState } from 'react';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Meldingen van de beheerder (N9.3, INTENTO-NEW-DESIGN §17): een e-mail per nieuw ontbrekend woord.
 * Standaard uit; de teller in het menu is de gewone melding. Eén e-mail per woord, niet per keer dat
 * het voorkomt.
 */
export function NotificationsPanel({ api }: { api: Api }): React.JSX.Element {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getAccountNotifications()
      .then(({ notifyGapsByEmail }) => {
        if (active) setOn(notifyGapsByEmail);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      });
    return () => {
      active = false;
    };
  }, [api]);

  async function change(next: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setOn((await api.updateAccountNotifications({ notifyGapsByEmail: next })).notifyGapsByEmail);
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
          checked={on ?? false}
          disabled={on === null || busy}
          onChange={(e) => void change(e.target.checked)}
        />
        <span>E-mail bij een nieuw ontbrekend woord</span>
      </label>
      <p className="muted">
        Eén e-mail per woord dat voor het eerst ontbreekt, niet elke keer dat het voorkomt. Je ziet
        de open woorden ook altijd bij "Ontbrekende woorden" in het menu.
      </p>
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
