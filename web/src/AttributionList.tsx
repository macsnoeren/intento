import type { AttributionSource } from '@intento/shared';
import { licenseLabel } from './VocabularyPage.tsx';

/**
 * Bronvermelding van de Vocabulary (INTENTO-NEW-DESIGN §15). Licenties als CC BY vragen om
 * naamsvermelding; deze lijst staat in de beheeromgeving én is bereikbaar vanaf de tablet.
 */

/**
 * Extra uitleg per bron. Het Mulberry-project noemt zelf CC BY-SA 2.0 UK, Global Symbols (waaruit we
 * importeren) CC BY-SA 4.0; we leggen vast wat de importbron zegt en noemen hier beide (§15.1).
 */
const SOURCE_NOTES: Record<string, string> = {
  'Mulberry Symbols':
    'Mulberry Symbols © Steve Lee. Geïmporteerd via Global Symbols onder CC BY-SA 4.0; het Mulberry-project zelf publiceert de symbolen onder CC BY-SA 2.0 UK. Beide licenties staan gebruik toe, met naamsvermelding. De Nederlandse labels zijn van Intento.',
  'Mulberry Plus Collection':
    'Mulberry Plus Collection van Mulberry en Global Symbols, onder CC BY-SA 4.0. De Nederlandse labels zijn van Intento.',
};

function Link({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

export function AttributionList({ sources }: { sources: AttributionSource[] }): React.JSX.Element {
  if (sources.length === 0) return <p className="muted">Er zijn nog geen symbolen.</p>;
  return (
    <ul className="attribution-list">
      {sources.map((source) => (
        <li
          key={`${source.sourceName}|${source.licenseKey}|${source.author ?? ''}`}
          className="panel"
        >
          <h2 className="panel__subtitle">
            <Link href={source.sourceUrl}>{source.sourceName}</Link>
          </h2>
          <dl className="definition-list">
            <dt>Licentie</dt>
            <dd>
              <Link href={source.licenseUrl}>{licenseLabel(source.licenseKey)}</Link>
            </dd>
            {source.author ? (
              <>
                <dt>Maker</dt>
                <dd>
                  <Link href={source.authorUrl}>{source.author}</Link>
                </dd>
              </>
            ) : null}
            <dt>Symbolen</dt>
            <dd>{source.items.length}</dd>
          </dl>
          {SOURCE_NOTES[source.sourceName] ? (
            <p className="muted">{SOURCE_NOTES[source.sourceName]}</p>
          ) : null}
          <details>
            <summary>Welke symbolen</summary>
            <p className="attribution-list__items">
              {source.items.map((item) => item.label).join(', ')}
            </p>
          </details>
        </li>
      ))}
    </ul>
  );
}
