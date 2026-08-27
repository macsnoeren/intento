/**
 * Keuzebalk tussen de onderdelen van één scherm (T17.4).
 *
 * Gebruikt waar een scherm te veel inhoud heeft om in één keer te tonen, maar de onderdelen wél bij
 * elkaar horen: de weergaven van het gebruikersoverzicht (gebruikers / logins) en de onderdelen van
 * één gebruiker (instellingen, begeleiders, context, …). Eén onderdeel tegelijk, over de volle
 * breedte — dat leest beter dan alles tegelijk in halve kolommen.
 *
 * Echte `tab`-semantiek (`tablist`/`tab`/`tabpanel`), zodat een schermlezer aankondigt hoeveel
 * onderdelen er zijn en waar je bent. De bijbehorende inhoud rendert de pagina zelf met
 * `tabPanelProps()`, zodat tab en paneel gegarandeerd naar elkaar verwijzen.
 */
export interface SegmentedTab<T extends string> {
  id: T;
  label: string;
}

/** Id van de knop van een onderdeel; ook waar het paneel naar terugwijst. */
function tabId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

/** Id van het paneel van een onderdeel. */
function panelId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}

/**
 * De eigenschappen voor het paneel dat bij het actieve onderdeel hoort. Spreid dit over het
 * omhullende element van de inhoud: `<div {...tabPanelProps('user', active)}>…</div>`.
 */
export function tabPanelProps(
  prefix: string,
  active: string,
): { id: string; role: 'tabpanel'; 'aria-labelledby': string } {
  return {
    id: panelId(prefix, active),
    role: 'tabpanel',
    'aria-labelledby': tabId(prefix, active),
  };
}

export function SegmentedTabs<T extends string>({
  label,
  prefix,
  tabs,
  active,
  onSelect,
}: {
  /** Waar de balk over gaat, bv. "Onderdelen van Sanne". Alleen voor schermlezers. */
  label: string;
  /** Uniek voorvoegsel voor de id's op deze pagina. */
  prefix: string;
  tabs: readonly SegmentedTab<T>[];
  active: T;
  onSelect: (id: T) => void;
}): React.JSX.Element {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={tabId(prefix, tab.id)}
          aria-selected={active === tab.id}
          aria-controls={panelId(prefix, tab.id)}
          className={`segmented__tab${active === tab.id ? ' segmented__tab--active' : ''}`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
