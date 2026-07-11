import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  PersonalContextCategory,
  PreferencePublic,
  PreferenceSuggestionAction,
} from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Voorkeuren en begeleider-suggesties (T6.3, DESIGN §3.8, §7.1 taak 5, FR-014).
 *
 * De beheerkant van het leermechanisme: de begeleider/beheerder ziet welke concepten de gebruiker vaak
 * kiest (geleerd uit **bevestigde** communicatie — deze weergave muteert de zekerheid nooit) en handelt de
 * suggestie af die ontstaat bij een vaak gekozen concept (DESIGN §3.8: "Wil je toevoegen: favoriete
 * activiteit — wandelen?"). Accepteren/aanpassen neemt het over als persoonlijke context; weigeren sluit de
 * suggestie. Alle data loopt via de backend (`/users/{id}/preferences`), tenant-/begeleider-gefilterd.
 */

/** Categorie-opties voor "aanpassen" (dezelfde gesloten taxonomie als de persoonlijke context). */
const CATEGORY_OPTIONS: { value: PersonalContextCategory; label: string }[] = [
  { value: 'PERSON', label: '👤 Persoon' },
  { value: 'PET', label: '🐾 Huisdier' },
  { value: 'PLACE', label: '📍 Plek' },
  { value: 'ACTIVITY', label: '⭐ Activiteit' },
  { value: 'FOOD', label: '🍽️ Eten & drinken' },
  { value: 'OBJECT', label: '🧸 Voorwerp' },
  { value: 'ROUTINE', label: '🔁 Routine' },
  { value: 'OTHER', label: '📝 Overig' },
];

/** Toont de zekerheid als leesbaar percentage (0–100%). */
function confidencePct(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** Klein "aanpassen"-formuliertje: kies een categorie en (voor-ingevulde) naam voordat je overneemt. */
function AdjustForm({
  initialName,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  onSubmit: (category: PersonalContextCategory, name: string) => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [category, setCategory] = useState<PersonalContextCategory>('ACTIVITY');
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onSubmit(category, trimmed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form context-form" onSubmit={(e) => void handleSubmit(e)}>
      <label className="field">
        <span className="field__label">Categorie</span>
        <select
          className="field__input"
          value={category}
          onChange={(e) => setCategory(e.target.value as PersonalContextCategory)}
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">Naam</span>
        <input
          className="field__input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          required
          autoFocus
        />
      </label>
      <div className="form__actions">
        <button className="button button--primary" type="submit" disabled={!trimmed || busy}>
          Toevoegen als context
        </button>
        <button className="button" type="button" onClick={onCancel} disabled={busy}>
          Annuleren
        </button>
      </div>
    </form>
  );
}

export function PreferencesPanel({
  api,
  userId,
  userName,
}: {
  api: Api;
  userId: string;
  userName: string;
}): React.JSX.Element {
  const [items, setItems] = useState<PreferencePublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { preferences } = await api.listPreferences(userId);
      setItems(preferences);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    } finally {
      setLoading(false);
    }
  }, [api, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function resolve(prefId: string, body: PreferenceSuggestionAction): Promise<void> {
    setError(null);
    try {
      const updated = await api.resolveSuggestion(userId, prefId, body);
      setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setAdjustingId(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Actie mislukt.');
    }
  }

  const suggestions = items.filter((p) => p.suggested);

  if (loading) {
    return (
      <section className="panel" aria-label={`Voorkeuren voor ${userName}`}>
        <h2 className="panel__subtitle">Voorkeuren</h2>
        <p className="muted">Laden…</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-label={`Voorkeuren voor ${userName}`}>
      <h2 className="panel__subtitle">Geleerde voorkeuren</h2>
      <p className="muted">
        Wat {userName} vaak kiest — geleerd uit bevestigde boodschappen. Zet leren aan/uit bij de
        communicatie-instellingen.
      </p>
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <div aria-label="Suggesties">
          <h3 className="panel__subtitle">Suggesties</h3>
          <ul className="context-list">
            {suggestions.map((pref) =>
              adjustingId === pref.id ? (
                <li key={pref.id} className="context-list__item context-list__item--editing">
                  <p className="muted">Toevoegen als persoonlijke context</p>
                  <AdjustForm
                    initialName={pref.label}
                    onSubmit={(category, name) =>
                      resolve(pref.id, { action: 'adjust', category, name })
                    }
                    onCancel={() => setAdjustingId(null)}
                  />
                </li>
              ) : (
                <li key={pref.id} className="context-list__item">
                  <span className="context-list__text">
                    <span className="context-list__name">
                      Wil je “{pref.label}” toevoegen als vaste context?
                    </span>
                    <span className="context-list__meta">
                      {pref.count}× gekozen · zekerheid {confidencePct(pref.confidence)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => void resolve(pref.id, { action: 'accept' })}
                  >
                    Toevoegen
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setAdjustingId(pref.id)}
                  >
                    Aanpassen
                  </button>
                  <button
                    type="button"
                    className="button button--danger"
                    onClick={() => void resolve(pref.id, { action: 'reject' })}
                    aria-label={`Suggestie ${pref.label} weigeren`}
                  >
                    Weigeren
                  </button>
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="muted">
          Nog geen voorkeuren. Zodra {userName} boodschappen bevestigt, verschijnen ze hier.
        </p>
      ) : (
        <ul className="context-list">
          {items.map((pref) => (
            <li key={pref.id} className="context-list__item">
              <span className="context-list__text">
                <span className="context-list__name">{pref.label}</span>
                <span className="context-list__meta">
                  {pref.count}× gekozen · zekerheid {confidencePct(pref.confidence)}
                  {pref.suggestionStatus === 'accepted' ? ' · als context toegevoegd' : ''}
                  {pref.suggestionStatus === 'dismissed' ? ' · suggestie geweigerd' : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
