import { useCallback, useEffect, useState } from 'react';
import {
  vocabularyContextSchema,
  type AccountPublic,
  type VocabularyGapPublic,
  type VocabularyGapStatus,
} from '@intento/shared';
import { ApiRequestError, apiUrl, type Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';
import { ExternalImportDialog } from './ExternalImportDialog.tsx';
import { Modal } from './Modal.tsx';
import { SegmentedTabs, tabPanelProps, type SegmentedTab } from './SegmentedTabs.tsx';
import { CONTEXT_LABELS, type WordPrefill } from './VocabularyItemDetail.tsx';
import { VocabularyUploadDialog } from './VocabularyUploadDialog.tsx';
import { useNavBadges } from './NavBadges.tsx';

/**
 * "Ontbrekende woorden" (N9.2, INTENTO-NEW-DESIGN §17, §49).
 *
 * Woorden die een gebruiker bedoelde, maar waarvoor de Vocabulary geen goed pictogram heeft: hij zag
 * het woord met het pictogram dat er het dichtst bij kwam. Per woord: hoe vaak, wanneer het laatst en
 * welk pictogram hij zag. "Woord toevoegen" opent de dialoog voor een eigen afbeelding of een import,
 * vooraf ingevuld met het woord en het concept; daarna is het woord opgelost. "Negeren" haalt het uit de
 * lijst. Er staat nooit bij wie het woord bedoelde.
 */

const TABS: readonly SegmentedTab<VocabularyGapStatus>[] = [
  { id: 'open', label: 'Open' },
  { id: 'dismissed', label: 'Genegeerd' },
  { id: 'resolved', label: 'Opgelost' },
];

type Adding = { gap: VocabularyGapPublic; via: 'upload' | 'external' };

function prefill(gap: VocabularyGapPublic): WordPrefill {
  const context = vocabularyContextSchema.safeParse(gap.context);
  return {
    label: gap.label,
    concepts: [gap.concept],
    contexts: context.success ? [context.data] : [],
    query: gap.concept.replace(/_/g, ' '),
  };
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' });
}

export function VocabularyGapsPage({
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
  const [tab, setTab] = useState<VocabularyGapStatus>('open');
  const [gaps, setGaps] = useState<VocabularyGapPublic[] | null>(null);
  const [open, setOpen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const { refresh } = useNavBadges();

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await api.listVocabularyGaps(tab);
      setGaps(body.items);
      setOpen(body.open);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    }
  }, [api, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(gap: VocabularyGapPublic, action: 'resolve' | 'dismiss' | 'reopen') {
    setBusy(gap.id);
    setError(null);
    try {
      await api.setVocabularyGapStatus(gap.id, action);
      await load();
      refresh(); // de teller in het menu
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Dat lukte niet.');
    } finally {
      setBusy(null);
    }
  }

  async function wordAdded(gap: VocabularyGapPublic): Promise<void> {
    setAdding(null);
    setAdded(gap.label);
    await change(gap, 'resolve');
  }

  return (
    <AppShell
      account={account}
      title="Ontbrekende woorden"
      subtitle="Woorden waarvoor nog geen goed pictogram is. De gebruiker zag het woord met het pictogram dat er het dichtst bij kwam."
      active="gaps"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <div className="toolbar">
        <SegmentedTabs
          label="Welke woorden"
          prefix="gaps"
          tabs={TABS}
          active={tab}
          onSelect={setTab}
        />
        <p className="muted toolbar__end" role="status">
          {open === 1 ? '1 woord open' : `${open} woorden open`}
        </p>
      </div>

      {added ? (
        <p className="form__ok" role="status">
          "{added}" is toegevoegd aan de Vocabulary.
        </p>
      ) : null}
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="panel" aria-label="Woorden" {...tabPanelProps('gaps', tab)}>
        {gaps === null ? (
          <p className="muted">Laden…</p>
        ) : gaps.length === 0 ? (
          <p className="muted">
            {tab === 'open' ? 'Er ontbreken nu geen woorden.' : 'Hier staan geen woorden.'}
          </p>
        ) : (
          <ul className="item-list">
            {gaps.map((gap) => (
              <li key={gap.id} className="item-row" aria-label={gap.label}>
                <div className="item-row__image">
                  {gap.bestAvailable?.imageUrl ? (
                    <img
                      src={apiUrl(gap.bestAvailable.imageUrl)}
                      alt={`In plaats daarvan: ${gap.bestAvailable.label}`}
                      width={56}
                      height={56}
                    />
                  ) : (
                    <span className="muted">Geen afbeelding</span>
                  )}
                </div>
                <div className="record__body">
                  <span className="record__title">{gap.label}</span>
                  <span className="record__meta">
                    {gap.occurrences === 1 ? '1 keer' : `${gap.occurrences} keer`} · laatst{' '}
                    {when(gap.lastSeenAt)}
                    {gap.bestAvailable ? ` · getoond met "${gap.bestAvailable.label}"` : ''}
                    {gap.context
                      ? ` · ${CONTEXT_LABELS[vocabularyContextSchema.catch('other').parse(gap.context)]}`
                      : ''}
                  </span>
                </div>
                <div className="item-row__actions">
                  {tab === 'open' ? (
                    <>
                      <button
                        className="button button--primary"
                        type="button"
                        disabled={busy === gap.id}
                        onClick={() => setAdding({ gap, via: 'upload' })}
                      >
                        Eigen afbeelding
                      </button>
                      <button
                        className="button"
                        type="button"
                        disabled={busy === gap.id}
                        onClick={() => setAdding({ gap, via: 'external' })}
                      >
                        Uit externe bron
                      </button>
                      <button
                        className="button"
                        type="button"
                        disabled={busy === gap.id}
                        onClick={() => void change(gap, 'dismiss')}
                      >
                        Negeren
                      </button>
                    </>
                  ) : (
                    <button
                      className="button"
                      type="button"
                      disabled={busy === gap.id}
                      onClick={() => void change(gap, 'reopen')}
                    >
                      Weer openzetten
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {adding?.via === 'upload' ? (
        <Modal title={`"${adding.gap.label}" toevoegen`} onClose={() => setAdding(null)}>
          <VocabularyUploadDialog
            api={api}
            initial={prefill(adding.gap)}
            onCancel={() => setAdding(null)}
            onCreated={() => void wordAdded(adding.gap)}
          />
        </Modal>
      ) : null}
      {adding?.via === 'external' ? (
        <Modal title={`"${adding.gap.label}" uit een externe bron`} onClose={() => setAdding(null)}>
          <ExternalImportDialog
            api={api}
            initial={prefill(adding.gap)}
            onCancel={() => setAdding(null)}
            onCreated={() => void wordAdded(adding.gap)}
          />
        </Modal>
      ) : null}
    </AppShell>
  );
}
