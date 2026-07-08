import { useState, type FormEvent } from 'react';
import {
  iconsPerScreenSchema,
  type IconsPerScreen,
  type UpdateSettingsRequest,
  type UserPublic,
} from '@intento/shared';

const ICON_OPTIONS: readonly IconsPerScreen[] = [2, 4, 6, 8];

/**
 * Instellingenformulier voor het communicatieprofiel van één gebruiker (DESIGN §5.3).
 * Aantal opties is beperkt tot 2/4/6/8 (radioknoppen, dus ongeldige waarden zijn in de UI
 * onmogelijk); de rest zijn aan/uit-schakelaars. Opslaan roept `PUT /users/{id}/settings` aan.
 */
export function SettingsForm({
  user,
  onSave,
}: {
  user: UserPublic;
  onSave: (id: string, settings: UpdateSettingsRequest) => Promise<void>;
}): React.JSX.Element {
  const [settings, setSettings] = useState<UpdateSettingsRequest>(user.communicationProfile);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      await onSave(user.id, settings);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="form"
      onSubmit={(e) => void handleSubmit(e)}
      aria-label={`Instellingen voor ${user.name}`}
    >
      <fieldset className="field">
        <legend className="field__label">Aantal opties per scherm</legend>
        <div className="choice-row">
          {ICON_OPTIONS.map((value) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name="iconsPerScreen"
                checked={settings.iconsPerScreen === value}
                onChange={() =>
                  setSettings((s) => ({ ...s, iconsPerScreen: iconsPerScreenSchema.parse(value) }))
                }
              />
              <span>{value}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.showText}
          onChange={(e) => setSettings((s) => ({ ...s, showText: e.target.checked }))}
        />
        <span>Tekst tonen onder pictogrammen</span>
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.aiLearningEnabled}
          onChange={(e) => setSettings((s) => ({ ...s, aiLearningEnabled: e.target.checked }))}
        />
        <span>AI leert van bevestigde communicatie</span>
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.supportMode}
          onChange={(e) => setSettings((s) => ({ ...s, supportMode: e.target.checked }))}
        />
        <span>Ondersteuningsmodus (begeleider tikt aan)</span>
      </label>

      <div className="form__actions">
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Opslaan…' : 'Instellingen opslaan'}
        </button>
        {saved ? (
          <span className="form__ok" role="status">
            Opgeslagen
          </span>
        ) : null}
      </div>
    </form>
  );
}
