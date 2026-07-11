import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { PersonalContextCategory, PersonalContextPublic } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Persoonlijke-contextwizard (T6.2, DESIGN §3.7 stap 3, §5.2, FR-013).
 *
 * Begeleider/beheerder legt stap voor stap de context van een gekoppelde gebruiker vast — belangrijke
 * personen, dagelijkse plekken, favorieten en routines — pictogram-ondersteund (een glyph per stap).
 * Na de wizard kan dezelfde context worden **beheerd** (bewerken/verwijderen). Alle data loopt via de
 * backend (`/users/{id}/context`), die per rij versleutelt en alléén context met `aiUsageAllowed=true`
 * aan de AI doorgeeft (T6.1, §6.3). Daarom staat per item een expliciete "AI mag dit gebruiken"-schakelaar.
 */

/** Pictogram + label per categorie (gesloten taxonomie, DESIGN §6.2). Gebruikt in wizard en beheerlijst. */
const CATEGORY_META: Record<PersonalContextCategory, { label: string; glyph: string }> = {
  PERSON: { label: 'Persoon', glyph: '👤' },
  PET: { label: 'Huisdier', glyph: '🐾' },
  PLACE: { label: 'Plek', glyph: '📍' },
  ACTIVITY: { label: 'Activiteit', glyph: '⭐' },
  FOOD: { label: 'Eten & drinken', glyph: '🍽️' },
  OBJECT: { label: 'Voorwerp', glyph: '🧸' },
  ROUTINE: { label: 'Routine', glyph: '🔁' },
  OTHER: { label: 'Overig', glyph: '📝' },
};

const CATEGORY_ORDER: PersonalContextCategory[] = [
  'PERSON',
  'PET',
  'PLACE',
  'ACTIVITY',
  'FOOD',
  'OBJECT',
  'ROUTINE',
  'OTHER',
];

/** De stappen van de wizard — de belangrijkste categorieën uit DESIGN §3.7, elk met eigen begeleidende tekst. */
const WIZARD_STEPS: { category: PersonalContextCategory; title: string; description: string }[] = [
  {
    category: 'PERSON',
    title: 'Belangrijke personen',
    description: 'Wie zijn de belangrijke mensen om de gebruiker heen? Voeg naam en relatie toe.',
  },
  {
    category: 'PLACE',
    title: 'Dagelijkse plekken',
    description: 'Plekken die vaak terugkomen: thuis, school, de dagbesteding, het park…',
  },
  {
    category: 'FOOD',
    title: 'Favoriet eten & drinken',
    description: 'Wat eet en drinkt de gebruiker het liefst?',
  },
  {
    category: 'ACTIVITY',
    title: 'Favoriete activiteiten',
    description: 'Wat doet de gebruiker graag? Denk aan hobby’s en vaste bezigheden.',
  },
  {
    category: 'ROUTINE',
    title: 'Vaste routines',
    description: 'Terugkerende momenten op een dag: opstaan, eten, naar bed…',
  },
];

/** Relatie (bv. "dochter") is alleen zinvol bij personen en huisdieren. */
function usesRelationship(category: PersonalContextCategory): boolean {
  return category === 'PERSON' || category === 'PET';
}

/**
 * Herbruikbaar formuliertje voor één context-item (in de wizard-stap én bij bewerken). Houdt zijn eigen
 * veldstaat bij en geeft bij verzenden de gevalideerde invoer terug; de categorie is bij toevoegen vast
 * (wizard-stap) en bij bewerken kiesbaar.
 */
function ContextForm({
  fixedCategory,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  fixedCategory?: PersonalContextCategory;
  initial?: PersonalContextPublic;
  submitLabel: string;
  onSubmit: (input: {
    category: PersonalContextCategory;
    name: string;
    relationship?: string;
    aiUsageAllowed: boolean;
  }) => Promise<void>;
  onCancel?: () => void;
}): React.JSX.Element {
  const [category, setCategory] = useState<PersonalContextCategory>(
    fixedCategory ?? initial?.category ?? 'PERSON',
  );
  const [name, setName] = useState(initial?.name ?? '');
  const [relationship, setRelationship] = useState(initial?.relationship ?? '');
  // Wizard/bewerken zijn een bewuste actie om de AI te helpen → standaard toestaan, maar zichtbaar te wissen.
  const [aiUsageAllowed, setAiUsageAllowed] = useState(initial?.aiUsageAllowed ?? true);
  const [busy, setBusy] = useState(false);

  const activeCategory = fixedCategory ?? category;
  const trimmed = name.trim();

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const rel = relationship.trim();
      await onSubmit({
        category: activeCategory,
        name: trimmed,
        relationship: usesRelationship(activeCategory) && rel ? rel : undefined,
        aiUsageAllowed,
      });
      if (!initial) {
        // Toevoegen: het veld leegmaken voor het volgende item; bewerken sluit zichzelf via onCancel.
        setName('');
        setRelationship('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form context-form" onSubmit={(e) => void handleSubmit(e)}>
      {fixedCategory ? null : (
        <label className="field">
          <span className="field__label">Categorie</span>
          <select
            className="field__input"
            value={category}
            onChange={(e) => setCategory(e.target.value as PersonalContextCategory)}
          >
            {CATEGORY_ORDER.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_META[cat].glyph} {CATEGORY_META[cat].label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span className="field__label">Naam</span>
        <input
          className="field__input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          required
          autoFocus={!initial}
        />
      </label>

      {usesRelationship(activeCategory) ? (
        <label className="field">
          <span className="field__label">Relatie (optioneel)</span>
          <input
            className="field__input"
            type="text"
            placeholder="bv. dochter, buurman, hond"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            maxLength={200}
          />
        </label>
      ) : null}

      <label className="toggle">
        <input
          type="checkbox"
          checked={aiUsageAllowed}
          onChange={(e) => setAiUsageAllowed(e.target.checked)}
        />
        <span>AI mag deze context gebruiken</span>
      </label>

      <div className="form__actions">
        <button className="button button--primary" type="submit" disabled={!trimmed || busy}>
          {submitLabel}
        </button>
        {onCancel ? (
          <button className="button" type="button" onClick={onCancel} disabled={busy}>
            Annuleren
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** Eén regel in de beheerlijst: pictogram, naam/relatie, AI-badge en bewerk-/verwijderknoppen. */
function ContextRow({
  item,
  onEdit,
  onDelete,
}: {
  item: PersonalContextPublic;
  onEdit: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const meta = CATEGORY_META[item.category];
  return (
    <li className="context-list__item">
      <span className="context-list__glyph" aria-hidden="true">
        {meta.glyph}
      </span>
      <span className="context-list__text">
        <span className="context-list__name">
          {item.name}
          {item.relationship ? ` (${item.relationship})` : ''}
        </span>
        <span className="context-list__meta">
          {meta.label}
          {item.aiUsageAllowed ? ' · AI' : ''}
        </span>
      </span>
      <button type="button" className="button" onClick={onEdit}>
        Bewerken
      </button>
      <button
        type="button"
        className="button button--danger"
        onClick={onDelete}
        aria-label={`${item.name} verwijderen`}
      >
        Verwijderen
      </button>
    </li>
  );
}

export function PersonalContextPanel({
  api,
  userId,
  userName,
}: {
  api: Api;
  userId: string;
  userName: string;
}): React.JSX.Element {
  const [items, setItems] = useState<PersonalContextPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'wizard' | 'manage'>('manage');
  const [stepIndex, setStepIndex] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { contexts } = await api.listPersonalContext(userId);
      setItems(contexts);
      // Nog geen context? Dan is de wizard het logische startpunt.
      setMode(contexts.length === 0 ? 'wizard' : 'manage');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    } finally {
      setLoading(false);
    }
  }, [api, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate(input: {
    category: PersonalContextCategory;
    name: string;
    relationship?: string;
    aiUsageAllowed: boolean;
  }): Promise<void> {
    setError(null);
    try {
      const created = await api.createPersonalContext(userId, input);
      setItems((prev) => [...prev, created]);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Opslaan mislukt.');
    }
  }

  async function handleUpdate(
    contextId: string,
    input: {
      category: PersonalContextCategory;
      name: string;
      relationship?: string;
      aiUsageAllowed: boolean;
    },
  ): Promise<void> {
    setError(null);
    try {
      const updated = await api.updatePersonalContext(userId, contextId, input);
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Opslaan mislukt.');
    }
  }

  async function handleDelete(contextId: string): Promise<void> {
    setError(null);
    try {
      await api.deletePersonalContext(userId, contextId);
      setItems((prev) => prev.filter((it) => it.id !== contextId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Verwijderen mislukt.');
    }
  }

  const errorBox = error ? (
    <p className="form__error" role="alert">
      {error}
    </p>
  ) : null;

  if (loading) {
    return (
      <section className="panel" aria-label={`Persoonlijke context voor ${userName}`}>
        <h2 className="panel__subtitle">Persoonlijke context</h2>
        <p className="muted">Laden…</p>
      </section>
    );
  }

  if (mode === 'wizard') {
    const step = WIZARD_STEPS[stepIndex]!;
    const stepItems = items.filter((it) => it.category === step.category);
    const isLast = stepIndex === WIZARD_STEPS.length - 1;
    return (
      <section className="panel" aria-label={`Persoonlijke-contextwizard voor ${userName}`}>
        <h2 className="panel__subtitle">Persoonlijke-contextwizard</h2>
        <p className="muted">
          Stap {stepIndex + 1} van {WIZARD_STEPS.length}
        </p>
        {errorBox}

        <div className="wizard-step">
          <p className="wizard-step__heading">
            <span className="wizard-step__glyph" aria-hidden="true">
              {CATEGORY_META[step.category].glyph}
            </span>
            <span className="wizard-step__title">{step.title}</span>
          </p>
          <p className="muted">{step.description}</p>

          {stepItems.length > 0 ? (
            <ul className="context-chips">
              {stepItems.map((it) => (
                <li key={it.id} className="context-chip">
                  {it.name}
                  {it.relationship ? ` (${it.relationship})` : ''}
                  <button
                    type="button"
                    className="context-chip__remove"
                    onClick={() => void handleDelete(it.id)}
                    aria-label={`${it.name} verwijderen`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nog niets toegevoegd voor deze stap.</p>
          )}

          <ContextForm
            key={step.category}
            fixedCategory={step.category}
            submitLabel="Toevoegen"
            onSubmit={handleCreate}
          />
        </div>

        <div className="form__actions wizard-nav">
          <button
            type="button"
            className="button"
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={stepIndex === 0}
          >
            Vorige
          </button>
          {isLast ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setStepIndex(0);
                setMode('manage');
              }}
            >
              Wizard afronden
            </button>
          ) : (
            <button
              type="button"
              className="button button--primary"
              onClick={() => setStepIndex((i) => Math.min(WIZARD_STEPS.length - 1, i + 1))}
            >
              Volgende
            </button>
          )}
        </div>
      </section>
    );
  }

  // Beheermodus: alle context, gesorteerd op categorie-volgorde, met bewerken/verwijderen.
  const sorted = [...items].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );
  return (
    <section className="panel" aria-label={`Persoonlijke context voor ${userName}`}>
      <div className="panel__head">
        <h2 className="panel__subtitle">Persoonlijke context</h2>
        <button
          type="button"
          className="button"
          onClick={() => {
            setEditingId(null);
            setStepIndex(0);
            setMode('wizard');
          }}
        >
          Wizard starten
        </button>
      </div>
      {errorBox}

      {sorted.length === 0 ? (
        <p className="muted">Nog geen context. Start de wizard om deze stap voor stap in te vullen.</p>
      ) : (
        <ul className="context-list">
          {sorted.map((item) =>
            editingId === item.id ? (
              <li key={item.id} className="context-list__item context-list__item--editing">
                <ContextForm
                  initial={item}
                  submitLabel="Opslaan"
                  onSubmit={(input) => handleUpdate(item.id, input)}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <ContextRow
                key={item.id}
                item={item}
                onEdit={() => setEditingId(item.id)}
                onDelete={() => void handleDelete(item.id)}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}
