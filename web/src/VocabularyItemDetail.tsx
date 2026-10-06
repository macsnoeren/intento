import { useState, type FormEvent } from 'react';
import {
  VOCABULARY_CONTEXTS,
  vocabularyUpdateRequestSchema,
  type AccountPublic,
  type VocabularyContext,
  type VocabularyItemPublic,
} from '@intento/shared';
import { ApiRequestError, apiUrl, type Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';
import { licenseLabel } from './VocabularyPage.tsx';

/**
 * Detailscherm van één Vocabulary-item (INTENTO-NEW-DESIGN §15, §16, §49).
 *
 * Het pictogram groot, de licentie en herkomst voluit (met links), en voor de beheerder het formulier
 * om labels, concepten, contexten, startconcept en volgorde aan te passen. Een begeleider ziet alles,
 * maar kan niets wijzigen. Een platformitem (de startset) mag alleen de platformbeheerder wijzigen; de
 * server zegt dat, en dan staat het hier in gewone taal.
 */

export const CONTEXT_LABELS: Record<VocabularyContext, string> = {
  health: 'Gezondheid',
  food_drink: 'Eten en drinken',
  feelings: 'Gevoelens',
  body: 'Lichaam',
  people: 'Mensen',
  places: 'Plaatsen',
  activities: 'Activiteiten',
  things: 'Dingen',
  time: 'Tijd',
  other: 'Overig',
};

/** Komma- of regelgescheiden tekst → lijst zonder lege of dubbele onderdelen. */
export function splitList(value: string): string[] {
  const parts = value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

function isContext(value: string): value is VocabularyContext {
  return (VOCABULARY_CONTEXTS as readonly string[]).includes(value);
}

function ExternalLink({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function VocabularyItemDetail({
  api,
  account,
  item,
  onBack,
  onSaved,
  onLogout,
  onNavigate,
}: {
  api: Api;
  account: AccountPublic;
  item: VocabularyItemPublic;
  onBack: () => void;
  onSaved: (item: VocabularyItemPublic) => void;
  onLogout: () => void;
  onNavigate: (view: AdminView) => void;
}): React.JSX.Element {
  const canEdit = account.role === 'ADMIN';
  const [labels, setLabels] = useState(item.labels.join(', '));
  const [concepts, setConcepts] = useState(item.concepts.join(', '));
  const [contexts, setContexts] = useState<VocabularyContext[]>(item.contexts.filter(isContext));
  const [isStart, setIsStart] = useState(item.isStart);
  const [sortOrder, setSortOrder] = useState(String(item.sortOrder));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);

  async function changeStatus(action: 'retire' | 'restore'): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      onSaved(await api.setVocabularyItemStatus(item.id, action));
      setConfirmRetire(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Dat lukte niet.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = vocabularyUpdateRequestSchema.safeParse({
      labels: splitList(labels),
      concepts: splitList(concepts),
      contexts,
      isStart,
      sortOrder: Number(sortOrder),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer de invoer.');
      return;
    }
    setBusy(true);
    try {
      onSaved(await api.updateVocabularyItem(item.id, parsed.data));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Opslaan mislukt.');
    } finally {
      setBusy(false);
    }
  }

  const title = item.labels[0] ?? item.id;
  return (
    <AppShell
      account={account}
      title={title}
      subtitle={
        item.scope === 'platform'
          ? 'Symbool uit de startset van het platform.'
          : 'Symbool van je eigen organisatie.'
      }
      active="vocabulary"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <div>
        <button className="detail-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Alle symbolen
        </button>
      </div>

      <section className="panel" aria-label="Pictogram en herkomst">
        <div className="symbol-image">
          {item.imageUrl ? (
            <img src={apiUrl(item.imageUrl)} alt={title} width={128} height={128} />
          ) : (
            <span className="muted">Geen afbeelding</span>
          )}
          <dl className="definition-list">
            <dt>Licentie</dt>
            <dd>
              <ExternalLink href={item.license.url}>{licenseLabel(item.license.key)}</ExternalLink>
            </dd>
            <dt>Maker</dt>
            <dd>
              <ExternalLink href={item.license.authorUrl}>
                {item.license.author ?? '—'}
              </ExternalLink>
            </dd>
            <dt>Bron</dt>
            <dd>
              <ExternalLink href={item.license.sourceUrl}>
                {item.source === 'own' ? 'Eigen afbeelding' : (item.license.sourceName ?? '—')}
              </ExternalLink>
              {item.license.sourceRef ? ` (${item.license.sourceRef})` : null}
            </dd>
            <dt>Vertaling</dt>
            <dd>
              {item.labelStatus === 'reviewed'
                ? 'Nagekeken'
                : 'Machinevertaling, nog niet nagekeken'}
            </dd>
          </dl>
        </div>
      </section>

      <section className="panel" aria-label="Betekenis">
        <h2 className="panel__subtitle">Betekenis</h2>
        {canEdit ? (
          <form className="form" aria-label={`${title} bewerken`} onSubmit={(e) => void submit(e)}>
            <label className="field">
              <span className="field__label">
                Labels (het eerste is het hoofdlabel, de rest synoniemen)
              </span>
              <input
                className="field__input"
                name="labels"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Concepten (bv. chest_pain)</span>
              <input
                className="field__input"
                name="concepts"
                value={concepts}
                onChange={(e) => setConcepts(e.target.value)}
              />
            </label>
            <fieldset className="field">
              <legend className="field__label">Contexten</legend>
              <div className="choice-row">
                {VOCABULARY_CONTEXTS.map((context) => (
                  <label key={context} className="choice">
                    <input
                      type="checkbox"
                      checked={contexts.includes(context)}
                      onChange={(e) =>
                        setContexts((list) =>
                          e.target.checked ? [...list, context] : list.filter((c) => c !== context),
                        )
                      }
                    />
                    <span>{CONTEXT_LABELS[context]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="toggle">
              <input
                type="checkbox"
                checked={isStart}
                onChange={(e) => setIsStart(e.target.checked)}
              />
              <span>Startconcept (wordt als eerste gevraagd)</span>
            </label>
            <label className="field">
              <span className="field__label">Volgorde</span>
              <input
                className="field__input"
                name="sortOrder"
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </label>
            {error ? (
              <p className="form__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="form__actions">
              <button className="button button--primary" type="submit" disabled={busy}>
                {busy ? 'Opslaan…' : 'Opslaan'}
              </button>
              {saved ? (
                <span className="form__ok" role="status">
                  Opgeslagen
                </span>
              ) : null}
            </div>
          </form>
        ) : (
          <dl className="definition-list">
            <dt>Labels</dt>
            <dd>{item.labels.join(', ')}</dd>
            <dt>Concepten</dt>
            <dd>{item.concepts.join(', ')}</dd>
            <dt>Contexten</dt>
            <dd>
              {item.contexts.map((c) => (isContext(c) ? CONTEXT_LABELS[c] : c)).join(', ') || '—'}
            </dd>
            <dt>Startconcept</dt>
            <dd>{item.isStart ? 'Ja' : 'Nee'}</dd>
          </dl>
        )}
      </section>
      {canEdit ? (
        <section className="panel panel--danger" aria-label="Intrekken">
          <h2 className="panel__subtitle">
            {item.status === 'retired' ? 'Ingetrokken' : 'Intrekken'}
          </h2>
          {item.status === 'retired' ? (
            <>
              <p className="muted">
                Dit symbool wordt niet meer aangeboden in gesprekken. Het blijft bewaard, omdat
                eerdere gesprekken ernaar kunnen verwijzen.
              </p>
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => void changeStatus('restore')}
              >
                Weer gebruiken
              </button>
            </>
          ) : confirmRetire ? (
            <>
              <p>Weet je het zeker? Het symbool verschijnt dan niet meer in gesprekken.</p>
              <div className="form__actions">
                <button
                  className="button button--danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void changeStatus('retire')}
                >
                  Ja, intrekken
                </button>
                <button className="button" type="button" onClick={() => setConfirmRetire(false)}>
                  Annuleren
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted">
                Een ingetrokken symbool wordt niet meer aangeboden, maar wordt nooit verwijderd. Je
                kunt het later weer gebruiken.
              </p>
              <button className="button" type="button" onClick={() => setConfirmRetire(true)}>
                Intrekken…
              </button>
            </>
          )}
        </section>
      ) : null}
    </AppShell>
  );
}
