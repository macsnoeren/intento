import { useState, type FormEvent } from 'react';
import {
  MAX_QUESTIONS_MAX,
  MAX_QUESTIONS_MIN,
  OPTIONS_PER_SCREEN_MAX,
  OPTIONS_PER_SCREEN_MIN,
  QUESTION_STRATEGY_CATALOG,
  SPEECH_VOICE_CATALOG,
  speechVoiceSchema,
  type InteractionModeSetting,
  type UpdateSettingsRequest,
  type UserPublic,
} from '@intento/shared';
import { ApiRequestError } from './api.ts';

/** De vormen met uitleg in gewone taal (INTENTO-NEW-DESIGN §11–§14). */
export const INTERACTION_MODE_OPTIONS: readonly {
  key: InteractionModeSetting;
  label: string;
  description: string;
}[] = [
  {
    key: 'binary',
    label: 'Ja of nee',
    description:
      'Eén pictogram met een vraag en twee knoppen: JA en NEE. Voor wie goed ja en nee kan zeggen, maar moeite heeft met kiezen uit meer dingen tegelijk.',
  },
  {
    key: 'multi',
    label: 'Meerdere pictogrammen',
    description:
      'Een vraag met een paar pictogrammen om uit te kiezen, plus "Geen van deze". Voor wie makkelijk kiest uit een rijtje.',
  },
  {
    key: 'ai',
    label: 'Laat Intento kiezen',
    description:
      'Intento begint met wat bij deze persoon het best werkte en wisselt alleen met een goede reden, nooit binnen drie vragen. Elke wissel wordt vastgelegd.',
  },
];

/**
 * Instellingenformulier voor het communicatieprofiel van één gebruiker (INTENTO-NEW-DESIGN §7.1, §50).
 * Opslaan roept `PUT /users/{id}/settings` aan met het volledige profiel. Elke keuze heeft uitleg in
 * gewone taal, want de begeleider kiest hier hoe deze persoon communiceert. "Opties per scherm" staat
 * er alleen bij multi-icon: bij ja/nee is het altijd één pictogram.
 *
 * De **stem** heeft een luisterknop: een stem kies je op gehoor en niet op een naam. Beluisteren
 * verandert niets — de keuze wordt pas bij Opslaan bewaard.
 */
/** Wat Experience betekent, in gewone taal (§22, V2). Ook gebruikt bij het aanmaken van een gebruiker. */
export const EXPERIENCE_EXPLANATION =
  'Intento onthoudt welke pictogrammen, contacten en vorm deze persoon vaak kiest en zet die eerder in beeld. Er verdwijnt nooit een keuze. Uitzetten kan altijd; dan wordt er niets meer onthouden.';

/** Een getal binnen de grenzen; een leeg of ongeldig veld laat de vorige waarde staan. */
function clamp(value: number, min: number, max: number, previous: number): number {
  if (!Number.isFinite(value)) return previous;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function SettingsForm({
  user,
  onSave,
  onPreviewVoice,
}: {
  user: UserPublic;
  onSave: (id: string, settings: UpdateSettingsRequest) => Promise<void>;
  /**
   * Laat één stem een voorbeeldzin zeggen. Ontbreekt hij, dan blijft de luisterknop weg —
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
        <legend className="field__label">Hoe wordt er gevraagd</legend>
        <div className="choice-list">
          {INTERACTION_MODE_OPTIONS.map((option) => (
            <label key={option.key} className="choice-block">
              <input
                type="radio"
                name="interactionMode"
                value={option.key}
                checked={settings.interactionMode === option.key}
                onChange={() => setSettings((s) => ({ ...s, interactionMode: option.key }))}
              />
              <span>
                <strong>{option.label}</strong>
                <small className="choice-block__hint">{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {settings.interactionMode === 'multi' ? (
        <label className="field">
          <span className="field__label">Pictogrammen per scherm</span>
          <small className="choice-block__hint">
            Minder is rustiger, meer is sneller. Tussen {OPTIONS_PER_SCREEN_MIN} en{' '}
            {OPTIONS_PER_SCREEN_MAX}.
          </small>
          <input
            className="field__input"
            type="number"
            name="optionsPerScreen"
            min={OPTIONS_PER_SCREEN_MIN}
            max={OPTIONS_PER_SCREEN_MAX}
            value={settings.optionsPerScreen}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                optionsPerScreen: clamp(
                  e.target.valueAsNumber,
                  OPTIONS_PER_SCREEN_MIN,
                  OPTIONS_PER_SCREEN_MAX,
                  s.optionsPerScreen,
                ),
              }))
            }
          />
        </label>
      ) : null}

      <fieldset className="field">
        <legend className="field__label">Manier van vragen</legend>
        <div className="choice-list">
          {QUESTION_STRATEGY_CATALOG.map((strategy) => (
            <label key={strategy.key} className="choice-block">
              <input
                type="radio"
                name="questionStrategy"
                value={strategy.key}
                checked={settings.questionStrategy === strategy.key}
                onChange={() => setSettings((s) => ({ ...s, questionStrategy: strategy.key }))}
              />
              <span>
                <strong>{strategy.label}</strong>
                <small className="choice-block__hint">{strategy.description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span className="field__label">Hoogstens zoveel vragen per gesprek</span>
        <small className="choice-block__hint">
          Daarna stelt Intento voor wat het het meest waarschijnlijk vindt, en vraagt anders of je
          wilt stoppen. Tussen {MAX_QUESTIONS_MIN} en {MAX_QUESTIONS_MAX}.
        </small>
        <input
          className="field__input"
          type="number"
          name="maxQuestions"
          min={MAX_QUESTIONS_MIN}
          max={MAX_QUESTIONS_MAX}
          value={settings.maxQuestions}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              maxQuestions: clamp(
                e.target.valueAsNumber,
                MAX_QUESTIONS_MIN,
                MAX_QUESTIONS_MAX,
                s.maxQuestions,
              ),
            }))
          }
        />
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.experienceEnabled}
          onChange={(e) => setSettings((s) => ({ ...s, experienceEnabled: e.target.checked }))}
        />
        <span>
          Leren van eerdere gesprekken
          <small className="choice-block__hint">{EXPERIENCE_EXPLANATION}</small>
        </span>
      </label>

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
