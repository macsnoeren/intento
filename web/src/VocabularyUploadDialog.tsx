import { useEffect, useState } from 'react';
import {
  VOCABULARY_CONTEXTS,
  type VocabularyContext,
  type VocabularyItemPublic,
} from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import { CONTEXT_LABELS, splitList, type WordPrefill } from './VocabularyItemDetail.tsx';

/** Wat de server accepteert; de controle op de werkelijke inhoud gebeurt daar (§53). */
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Eigen afbeelding + woord toevoegen (N8.2, INTENTO-NEW-DESIGN §15, §49).
 *
 * De beheerder kiest een afbeelding (met voorbeeld), geeft het woord, eventueel synoniemen, de concepten
 * en de contexten, en bevestigt dat de organisatie de afbeelding mag gebruiken. Zonder dat vinkje kan er
 * niet opgeslagen worden: de licentie wordt `own`, op naam van wie hem toevoegt.
 */
export function VocabularyUploadDialog({
  api,
  initial,
  onCreated,
  onCancel,
}: {
  api: Api;
  /** Vooraf ingevuld, bv. vanuit "Ontbrekende woorden" (N9.2): woord, concept en context van de gap. */
  initial?: WordPrefill;
  onCreated: (item: VocabularyItemPublic) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [label, setLabel] = useState(initial?.label ?? '');
  const [synonyms, setSynonyms] = useState('');
  const [concepts, setConcepts] = useState(initial?.concepts.join(', ') ?? '');
  const [contexts, setContexts] = useState<VocabularyContext[]>(initial?.contexts ?? []);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Het voorbeeld is een tijdelijke URL naar het gekozen bestand; opruimen bij een nieuwe keuze.
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(chosen: File | null): void {
    setError(null);
    if (chosen && !ACCEPTED_TYPES.includes(chosen.type)) {
      setFile(null);
      setError('Kies een PNG-, JPEG- of WebP-afbeelding.');
      return;
    }
    setFile(chosen);
  }

  const conceptList = splitList(concepts);
  const ready = Boolean(file) && label.trim().length > 0 && conceptList.length > 0 && rights;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!file || !ready) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api.uploadVocabularyItem({
          file,
          label: label.trim(),
          synonyms: splitList(synonyms),
          concepts: conceptList,
          contexts,
          rightsConfirmed: rights,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Opslaan mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" aria-label="Eigen afbeelding toevoegen" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span className="field__label">Afbeelding (PNG, JPEG of WebP)</span>
        <input
          className="field__input"
          type="file"
          name="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />
      </label>
      {preview ? (
        <img className="upload__preview" src={preview} alt="Voorbeeld van de gekozen afbeelding" />
      ) : null}
      <label className="field">
        <span className="field__label">Woord</span>
        <input
          className="field__input"
          name="label"
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Synoniemen (met komma's)</span>
        <input
          className="field__input"
          name="synonyms"
          value={synonyms}
          onChange={(e) => setSynonyms(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Concepten (Engels, kleine letters, bv. grandfather)</span>
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
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
        <span>Wij mogen deze afbeelding gebruiken (zelf gemaakt of met toestemming).</span>
      </label>
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form__actions">
        <button className="button" type="button" onClick={onCancel}>
          Annuleren
        </button>
        <button className="button button--primary" type="submit" disabled={!ready || busy}>
          Toevoegen
        </button>
      </div>
    </form>
  );
}
