/**
 * Navigatie tussen de beheerpagina's (T3.2). De beheeromgeving heeft nu drie onderdelen —
 * gebruikersbeheer (fase 2), de AAC-bibliotheek (fase 3) en het worker-tokenbeheer (T5.8) — met
 * dezelfde koptekst en uitlogknop. Deze tabs schakelen ertussen; de actieve tab is niet klikbaar
 * (`aria-current`).
 */
export type AdminView = 'users' | 'aac' | 'worker-tokens';

const TABS: { view: AdminView; label: string }[] = [
  { view: 'users', label: 'Gebruikers' },
  { view: 'aac', label: 'AAC-bibliotheek' },
  { view: 'worker-tokens', label: 'Worker-tokens' },
];

export function AdminNav({
  active,
  onNavigate,
}: {
  active: AdminView;
  onNavigate: (view: AdminView) => void;
}): React.JSX.Element {
  return (
    <nav className="admin__nav" aria-label="Beheer">
      {TABS.map(({ view, label }) => (
        <button
          key={view}
          type="button"
          className={`admin__tab${active === view ? ' admin__tab--active' : ''}`}
          aria-current={active === view ? 'page' : undefined}
          onClick={() => onNavigate(view)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
