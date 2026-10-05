import { useState, type FormEvent } from 'react';
import {
  SPEECH_VOICE_CATALOG,
  speechVoiceSchema,
  type UpdateSettingsRequest,
  type UserPublic,
} from '@intento/shared';
import { ApiRequestError } from './api.ts';

/**
 * Instellingenformulier voor het communicatieprofiel van één gebruiker (INTENTO-NEW-DESIGN §50).
 * Opslaan roept `PUT /users/{id}/settings` aan met het volledige profiel; velden die hier (nog) niet
 * staan, gaan ongewijzigd mee. De nieuwe communicatie-instellingen volgen in N3.2.
 *
 * De **stem** heeft een luisterknop: een stem kies je op gehoor en niet op een naam. Beluisteren
 * verandert niets — de keuze wordt pas bij Opslaan bewaard.
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
