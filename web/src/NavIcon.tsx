/**
 * Menupictogrammen (T17.1): één set lijnicoontjes voor de zijbalk.
 *
 * Bewust getekende SVG's en geen emoji: emoji zijn per besturingssysteem anders vormgegeven en
 * ingekleurd, waardoor het menu op elk apparaat een andere indruk maakt — en naast een rustige,
 * zakelijke zijbalk vallen ze uit de toon. Deze icoontjes volgen `currentColor`, dus ze verkleuren
 * mee met de actieve menu-ingang.
 *
 * De icoontjes zijn nooit de enige aanduiding: het label staat er altijd voluit naast (DESIGN §5.1).
 */
export type NavIconName =
  | 'dashboard'
  | 'question'
  | 'conversations'
  | 'users'
  | 'library'
  | 'proposals'
  | 'key'
  | 'ai'
  | 'audit'
  | 'account';

/** De vorm per icoon, in een 24×24-raster. */
const PATHS: Record<NavIconName, React.ReactNode> = {
  // Staafdiagram: het overzicht.
  dashboard: (
    <>
      <path d="M4 19V11" />
      <path d="M10 19V5" />
      <path d="M16 19v-6" />
      <path d="M3 21h18" />
    </>
  ),
  // Spraakbel met een vraagteken: de begeleider stelt een vraag.
  question: (
    <>
      <path d="M20 15a3 3 0 0 1-3 3H9l-5 3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z" />
      <path d="M10 9a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.4" />
      <path d="M12 14.6h.01" />
    </>
  ),
  // Twee bellen: een teruggelezen gesprek.
  conversations: (
    <>
      <path d="M17 11a3 3 0 0 1-3 3H9l-4 3V6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3z" />
      <path d="M9 17v1a3 3 0 0 0 3 3h4l4 3v-8a3 3 0 0 0-3-3h-1" />
    </>
  ),
  // Twee personen: de gebruikers van de organisatie.
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" />
      <path d="M16 4.5a3.2 3.2 0 0 1 0 6.4" />
      <path d="M17.5 14.2A5 5 0 0 1 21 19v1" />
    </>
  ),
  // Raster van pictogrammen: de AAC-bibliotheek.
  library: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </>
  ),
  // Vonk: een begrip dat de AI zelf aandroeg.
  proposals: (
    <>
      <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z" />
      <path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </>
  ),
  // Sleutel: toegang voor AI-workers.
  key: (
    <>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9" />
      <path d="M17.5 12v3.5" />
      <path d="M20.5 12v2.5" />
    </>
  ),
  // Chip: het denkwerk op de achtergrond.
  ai: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="3" />
      <path d="M10 3v3.5M14 3v3.5M10 17.5V21M14 17.5V21" />
      <path d="M3 10h3.5M3 14h3.5M17.5 10H21M17.5 14H21" />
    </>
  ),
  // Document met een vinkje: het spoor van gevoelige acties.
  audit: (
    <>
      <path d="M6 3h8l5 5v13H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 14.5l2 2 4-4" />
    </>
  ),
  // Persoon in een cirkel: jezelf.
  account: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.5 19a6 6 0 0 1 11 0" />
    </>
  ),
};

export function NavIcon({ name }: { name: NavIconName }): React.JSX.Element {
  return (
    <svg
      className="app-nav__icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
