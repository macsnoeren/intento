import { useState, type FormEvent } from 'react';
import {
  CONVERSATION_STRATEGY_CATALOG,
  SPEECH_VOICE_CATALOG,
  conversationStrategySchema,
  iconsPerScreenSchema,
  speechVoiceSchema,
  type IconsPerScreen,
  type UpdateSettingsRequest,
  type UserPublic,
} from '@intento/shared';
import { ApiRequestError } from './api.ts';

const ICON_OPTIONS: readonly IconsPerScreen[] = [2, 4, 6, 8];

/**
 * Instellingenformulier voor het communicatieprofiel van één gebruiker (DESIGN §5.3).
 * Aantal opties is beperkt tot 2/4/6/8 (radioknoppen, dus ongeldige waarden zijn in de UI
 * onmogelijk); de rest zijn aan/uit-schakelaars. Opslaan roept `PUT /users/{id}/settings` aan.
 *
 * De **gespreksstrategie** (T11.4, DESIGN §7.10) staat er als radiokeuze bij, met per optie de uitleg
 * erbij in plaats van erachter verstopt: de begeleider kiest hier hóe de AI naar de bedoeling van deze
 * persoon zoekt, en dat is alleen een geïnformeerde keuze als hij ziet voor wie een aanpak bedoeld is.
 *
 * De **stem** (T18.2, DESIGN §5.3) werkt net zo, maar met een luisterknop erbij: een stem kies je op
 * gehoor en niet op een naam. Beluisteren verandert niets — de keuze wordt pas bij Opslaan bewaard.
 */
export function SettingsForm({
  user,
  onSave,
  onPreviewVoice,
}: {
  user: UserPublic;
  onSave: (id: string, settings: UpdateSettingsRequest) => Promise<void>;
  /**
   * Laat één stem een voorbeeldzin zeggen (T18.2). Ontbreekt hij, dan blijft de luisterknop weg —
   * handig in schermen waar geen geluid hoort.
   */
  onPreviewVoice?: (voice: string) => Promise<void>;
}): React.JSX.Element {
  const [settings, setSettings] = useState<UpdateSettingsRequest>(user.communicationProfile);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  /** Welke stem er nu klinkt (voor de knoptekst) en wat er misging bij het beluisteren. */
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function preview(voice: string): Promise<void> {
    if (!onPreviewVoice) return;
    setPreviewError(null);
    setPreviewing(voice);
    try {
      await onPreviewVoice(voice);
    } catch (err) {
      // Toon wát er misging in plaats van alleen "lukte niet": de server weet of de spraakdienst
      // ontbreekt, een stemmodel stuk is of de aanvraag te lang duurde, en zonder die zin gaat een
      // beheerder op zoek naar een dienst die gewoon draait.
      setPreviewError(
        err instanceof ApiRequestError
          ? `Beluisteren lukte niet: ${err.message}`
          : 'Beluisteren lukte niet. Draait de spraakdienst?',
      );
    } finally {
      setPreviewing(null);
    }
  }

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

      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.speechEnabled}
          onChange={(e) => setSettings((s) => ({ ...s, speechEnabled: e.target.checked }))}
        />
        <span>De tablet leest voor wat er op het scherm staat</span>
      </label>

      <fieldset className="field" disabled={!settings.speechEnabled}>
        <legend className="field__label">Stem</legend>
        <div className="choice-list">
          {SPEECH_VOICE_CATALOG.map((voice) => (
            <label key={voice.id} className="choice-block">
              <input
                type="radio"
                name="speechVoice"
                value={voice.id}
                checked={settings.speechVoice === voice.id}
                onChange={() =>
                  setSettings((s) => ({ ...s, speechVoice: speechVoiceSchema.parse(voice.id) }))
                }
              />
              <span>
                <strong>{voice.label}</strong>
                {voice.voiceType ? (
                  <small className="choice-block__hint">
                    {voice.voiceType === 'vrouw' ? 'Vrouwenstem' : 'Mannenstem'}
                    {voice.region === 'nl_BE' ? ' · Vlaams' : ' · Nederlands'}
                  </small>
                ) : null}
                <small className="choice-block__hint">{voice.description}</small>
                {onPreviewVoice ? (
                  <button
                    className="button"
                    type="button"
                    disabled={previewing !== null}
                    aria-label={`${voice.label} beluisteren`}
                    onClick={() => void preview(voice.id)}
                  >
                    {previewing === voice.id ? '🔊 Klinkt…' : '🔊 Beluister'}
                  </button>
                ) : null}
              </span>
            </label>
          ))}
        </div>
        {previewError ? (
          <p className="form__error" role="alert">
            {previewError}
          </p>
        ) : null}
      </fieldset>

      <label className="toggle">
        <input
          type="checkbox"
          disabled={!settings.speechEnabled}
          checked={settings.speechHints}
          onChange={(e) => setSettings((s) => ({ ...s, speechHints: e.target.checked }))}
        />
        <span>Af en toe hardop uitleggen hoe de knoppen werken</span>
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
