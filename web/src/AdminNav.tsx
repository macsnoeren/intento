/**
 * Navigatie tussen de beheerpagina's (T3.2). De beheeromgeving heeft nu een dashboard (T7.3),
 * gebruikersbeheer (fase 2), de begeleidersweergave "Begeleiden" (T9.1: een beheerder mag ook
 * begeleider zijn), de AAC-bibliotheek (fase 3), de reviewlijst van AI-conceptvoorstellen (T7.3),
 * het worker-tokenbeheer (T5.8), het AI-activiteitenoverzicht (T9.15), het teruglezen van gesprekken (T12.1) en het eigen account (T2.5) — met dezelfde koptekst en uitlogknop.
 * Deze tabs schakelen ertussen; de actieve tab is niet klikbaar (`aria-current`).
 */
export type AdminView =
  | 'dashboard'
  | 'users'
  | 'question'
  | 'aac'
  | 'proposals'
  | 'worker-tokens'
  | 'ai-activity'
  | 'conversations'
  | 'audit-logs'
  | 'account';

const TABS: { view: AdminView; label: string }[] = [
  { view: 'dashboard', label: 'Dashboard' },
  { view: 'users', label: 'Gebruikers' },
  { view: 'question', label: 'Begeleiden' },
  { view: 'aac', label: 'AAC-bibliotheek' },
  { view: 'proposals', label: 'Conceptvoorstellen' },
  { view: 'worker-tokens', label: 'Worker-tokens' },
  { view: 'ai-activity', label: 'AI-activiteit' },
  { view: 'conversations', label: 'Gesprekken' },
  { view: 'audit-logs', label: 'Audit-log' },
  { view: 'account', label: 'Mijn account' },
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
