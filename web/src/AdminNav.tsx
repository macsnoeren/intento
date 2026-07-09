/**
 * Navigatie tussen de beheerpagina's (T3.2). De beheeromgeving heeft nu twee onderdelen —
 * gebruikersbeheer (fase 2) en de AAC-bibliotheek (fase 3) — met dezelfde koptekst en
 * uitlogknop. Deze tabs schakelen ertussen; de actieve tab is niet klikbaar (`aria-current`).
 */
export type AdminView = 'users' | 'aac';

export function AdminNav({
  active,
  onNavigate,
}: {
  active: AdminView;
  onNavigate: (view: AdminView) => void;
}): React.JSX.Element {
  return (
    <nav className="admin__nav" aria-label="Beheer">
      <button
        type="button"
        className={`admin__tab${active === 'users' ? ' admin__tab--active' : ''}`}
        aria-current={active === 'users' ? 'page' : undefined}
        onClick={() => onNavigate('users')}
      >
        Gebruikers
      </button>
      <button
        type="button"
        className={`admin__tab${active === 'aac' ? ' admin__tab--active' : ''}`}
        aria-current={active === 'aac' ? 'page' : undefined}
        onClick={() => onNavigate('aac')}
      >
        AAC-bibliotheek
      </button>
    </nav>
  );
}
