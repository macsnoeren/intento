import { NavIcon, type NavIconName } from './NavIcon.tsx';

/**
 * Het hoofdmenu van de web-applicatie (T3.2, uitgebreid in T17.1).
 *
 * Tot T17.1 stonden alle bestemmingen als één rij tabs onder de paginatitel. Met tien bestemmingen
 * werd dat een muur van gelijkwaardige knoppen: "Worker-tokens" (platformonderhoud) stond even groot
 * en even dichtbij als "Gebruikers" (dagelijks werk), en op een tablet in staande stand liep de rij
 * over meerdere regels door. Het menu is daarom **gegroepeerd** naar wat iemand komt doen — het werk
 * aan tafel, het beheer van de organisatie, en het onderhoud van het platform — en staat in een
 * zijbalk die op elke pagina hetzelfde is.
 *
 * De groepen zijn `role="group"` met een label in plaats van koppen: het menu hoort de koppenstructuur
 * van de pagina zelf niet te verstoren.
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

/** Rollen die een menu krijgen. Een begeleider ziet alleen wat hij mag (zie `VIEWS_BY_ROLE`). */
export type NavRole = 'ADMIN' | 'CAREGIVER';

export interface NavItem {
  view: AdminView;
  label: string;
  /** Pictogram vóór het label. Puur visueel houvast; staat `aria-hidden` en vervangt nooit tekst. */
  icon: NavIconName;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Overzicht',
    items: [{ view: 'dashboard', label: 'Dashboard', icon: 'dashboard' }],
  },
  {
    label: 'Communicatie',
    items: [
      { view: 'question', label: 'Begeleiden', icon: 'question' },
      { view: 'conversations', label: 'Gesprekken', icon: 'conversations' },
    ],
  },
  {
    label: 'Organisatie',
    items: [
      { view: 'users', label: 'Gebruikers', icon: 'users' },
      { view: 'aac', label: 'AAC-bibliotheek', icon: 'library' },
      { view: 'proposals', label: 'Conceptvoorstellen', icon: 'proposals' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { view: 'worker-tokens', label: 'Worker-tokens', icon: 'key' },
      { view: 'ai-activity', label: 'AI-activiteit', icon: 'ai' },
      { view: 'audit-logs', label: 'Audit-log', icon: 'audit' },
    ],
  },
  {
    label: 'Account',
    items: [{ view: 'account', label: 'Mijn account', icon: 'account' }],
  },
];

/**
 * Wat een rol in het menu ziet. Een begeleider begeleidt en beheert zijn eigen account — verder
 * niets; de server weigert de rest sowieso, maar een menu vol knoppen die 403 opleveren is geen
 * menu. Dit is géén beveiliging: de autorisatie zit in de backend (DESIGN §6.2).
 */
const VIEWS_BY_ROLE: Record<NavRole, AdminView[] | 'all'> = {
  ADMIN: 'all',
  CAREGIVER: ['question', 'account'],
};

/** De zichtbare groepen voor een rol; groepen die daarna leeg zijn vallen weg. */
export function groupsForRole(role: NavRole): NavGroup[] {
  const allowed = VIEWS_BY_ROLE[role];
  if (allowed === 'all') return GROUPS;
  return GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => allowed.includes(item.view)),
  })).filter((group) => group.items.length > 0);
}

/** Het label van een bestemming — de paginatitels en het menu blijven zo gelijk. */
export function labelForView(view: AdminView): string {
  for (const group of GROUPS) {
    const item = group.items.find((candidate) => candidate.view === view);
    if (item) return item.label;
  }
  return view;
}

export function AdminNav({
  active,
  role = 'ADMIN',
  onNavigate,
}: {
  active: AdminView;
  /** Bepaalt welke bestemmingen in het menu staan; standaard het volledige beheermenu. */
  role?: NavRole;
  onNavigate: (view: AdminView) => void;
}): React.JSX.Element {
  return (
    <nav className="app-nav" aria-label="Beheer">
      {groupsForRole(role).map((group) => (
        <div className="app-nav__group" role="group" aria-label={group.label} key={group.label}>
          <span className="app-nav__group-label" aria-hidden="true">
            {group.label}
          </span>
          {group.items.map(({ view, label, icon }) => (
            <button
              key={view}
              type="button"
              className={`app-nav__item${active === view ? ' app-nav__item--active' : ''}`}
              aria-current={active === view ? 'page' : undefined}
              onClick={() => onNavigate(view)}
            >
              <NavIcon name={icon} />
              <span className="app-nav__label">{label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
