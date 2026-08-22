import { useState, type FormEvent } from 'react';
import {
  CONVERSATION_STRATEGY_CATALOG,
  conversationStrategySchema,
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
 *
 * De **gespreksstrategie** (T11.4, DESIGN §7.10) staat er als radiokeuze bij, met per optie de uitleg
 * erbij in plaats van erachter verstopt: de begeleider kiest hier hóe de AI naar de bedoeling van deze
 * persoon zoekt, en dat is alleen een geïnformeerde keuze als hij ziet voor wie een aanpak bedoeld is.
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

      <fieldset className="field">
        <legend className="field__label">Hoe de AI naar de bedoeling zoekt</legend>
        <div className="choice-list">
          {CONVERSATION_STRATEGY_CATALOG.map((strategy) => (
            <label key={strategy.key} className="choice-block">
              <input
                type="radio"
                name="conversationStrategy"
                value={strategy.key}
                checked={settings.conversationStrategy === strategy.key}
                onChange={() =>
                  setSettings((s) => ({
                    ...s,
                    conversationStrategy: conversationStrategySchema.parse(strategy.key),
                  }))
                }
              />
              <span>
                <strong>{strategy.label}</strong>
                <small className="choice-block__hint">{strategy.description}</small>
              </span>
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

      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.contextIndicator}
          onChange={(e) => setSettings((s) => ({ ...s, contextIndicator: e.target.checked }))}
        />
        <span>Contextindicator tonen (broodkruimel van het gekozen pad)</span>
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
