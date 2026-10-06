import { useEffect, useState, type FormEvent } from 'react';
import {
  RETENTION_DAYS_MAX,
  RETENTION_DAYS_MIN,
  updateOrganizationSettingsSchema,
  type AccountPublic,
  type OrganizationSettings,
} from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';

/**
 * Beheeromgeving — Organisatie (INTENTO-NEW-DESIGN §49, §53): de bewaartermijn. Gesprekken, wat er
 * getoond en gekozen is, wat de AI dacht, bevestigde berichten en verzendingen worden na deze termijn
 * verwijderd. Experience blijft tot hij gewist wordt; ontbrekende woorden bevatten geen persoonsgegevens.
 */
export function OrganizationPage({
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
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [useDefault, setUseDefault] = useState(true);
  const [days, setDays] = useState('90');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function apply(next: OrganizationSettings): void {
    setSettings(next);
    setUseDefault(next.usesDefault);
    setDays(String(next.retentionDays));
  }

  useEffect(() => {
    let active = true;
    api
      .getOrganizationSettings()
      .then((next) => {
        if (active) apply(next);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      });
    return () => {
      active = false;
    };
  }, [api]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = updateOrganizationSettingsSchema.safeParse({
      retentionDays: useDefault ? null : Number(days),
    });
    if (!parsed.success) {
      setError(`Kies een termijn tussen ${RETENTION_DAYS_MIN} en ${RETENTION_DAYS_MAX} dagen.`);
      return;
    }
    setBusy(true);
    try {
      apply(await api.updateOrganizationSettings(parsed.data));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Opslaan mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      account={account}
      title="Organisatie"
      subtitle="Instellingen die voor de hele organisatie gelden."
      active="organization"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <section className="panel" aria-label="Bewaartermijn">
        <h2 className="panel__subtitle">Bewaartermijn</h2>
        <p className="muted">
          Hoe lang Intento gesprekken bewaart: wat er getoond en gekozen is, wat de AI dacht,
          bevestigde berichten en verzendingen. Daarna worden ze verwijderd. Wat Intento over een
          gebruiker geleerd heeft (Experience) blijft tot je het wist.
        </p>
        {settings ? (
          <form
            className="form"
            aria-label="Bewaartermijn"
            noValidate
            onSubmit={(e) => void submit(e)}
          >
            <label className="toggle">
              <input
                type="checkbox"
                checked={useDefault}
                onChange={(e) => setUseDefault(e.target.checked)}
              />
              <span>Standaard gebruiken ({settings.retentionDaysDefault} dagen)</span>
            </label>
            {useDefault ? null : (
              <label className="field">
                <span className="field__label">
                  Aantal dagen ({RETENTION_DAYS_MIN} tot {RETENTION_DAYS_MAX})
                </span>
                <input
                  className="field__input"
                  type="number"
                  name="retentionDays"
                  min={RETENTION_DAYS_MIN}
                  max={RETENTION_DAYS_MAX}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </label>
            )}
            {error ? (
              <p className="form__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="form__actions">
              <button className="button button--primary" type="submit" disabled={busy}>
                Opslaan
              </button>
              {saved ? (
                <span className="form__ok" role="status">
                  Opgeslagen: {settings.retentionDays} dagen
                </span>
              ) : null}
            </div>
          </form>
        ) : error ? (
          <p className="form__error" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted">Laden…</p>
        )}
      </section>
    </AppShell>
  );
}
