/**
 * De huisstijl van Intento op één plek: de naam, de payoff en de logobestanden.
 *
 * De bestanden staan in `web/public/brand/` en zijn met `web/brand/generate-assets.py` afgeleid van
 * het bronlogo (zie `web/brand/README.md`). Ze staan bewust in `public/` en niet in de bundel: het
 * zijn ook de bestanden waar `index.html` (favicon, app-icoon) naar wijst, en dan hoort er maar één
 * kopie te bestaan.
 *
 * Waarom componenten en geen kale `<img>`-tags: het logo krijgt overal dezelfde alt-tekst en vaste
 * afmetingen mee. Zonder `width`/`height` springt de kopbalk bij het laden (layout shift), en met
 * een alt-tekst per plek zegt een schermlezer op de ene pagina "Intento" en op de andere niets.
 */

/** Paden naar de gegenereerde logobestanden. Eén plek, zodat een hernoeming niet door de app lekt. */
export const BRAND_ASSETS = {
  /** Beeldmerk voor kopbalken (128 px bron — klein bestand, scherp tot ~64 px weergave). */
  mark: '/brand/intento-mark-128.png',
  /** Beeldmerk op ware grootte, voor grote weergaven. */
  markLarge: '/brand/intento-mark.png',
  /** Beeldmerk + woordmerk naast elkaar: de vorm die in een kopbalk past. */
  lockup: '/brand/intento-lockup.png',
  /** Het volledige logo (beeldmerk, woordmerk, payoff) — voor inlog- en welkomstschermen. */
  logo: '/brand/intento-logo.png',
  /** Beeldmerk op een wit, afgerond vlak — voor donkere ondergronden. */
  tile: '/brand/intento-tile.png',
} as const;

export const BRAND_NAME = 'Intento';
export const BRAND_PAYOFF = 'Jouw stem. Jouw verhaal.';

/** Verhoudingen van de bronbestanden; gebruikt om de hoogte-breedteverhouding vast te zetten. */
const LOCKUP_RATIO = 453 / 128;
const LOGO_RATIO = 768 / 718;

/**
 * Alleen het beeldmerk (de spraakbel). Decoratief waar de naam er in tekst naast staat — dan is
 * `alt=""` juist: anders leest een schermlezer "Intento Intento".
 */
export function BrandMark({
  size = 40,
  decorative = true,
}: {
  /** Weergavehoogte in pixels. */
  size?: number;
  /** Staat de naam er als tekst naast? Dan hoeft het beeldmerk niet nog eens voorgelezen te worden. */
  decorative?: boolean;
}): React.JSX.Element {
  return (
    <img
      className="brand__mark"
      src={BRAND_ASSETS.mark}
      alt={decorative ? '' : BRAND_NAME}
      aria-hidden={decorative || undefined}
      width={size}
      height={size}
    />
  );
}

/** Beeldmerk + woordmerk naast elkaar: de kopbalkvariant. */
export function BrandLockup({ height = 32 }: { height?: number }): React.JSX.Element {
  return (
    <img
      className="brand__lockup"
      src={BRAND_ASSETS.lockup}
      alt={BRAND_NAME}
      width={Math.round(height * LOCKUP_RATIO)}
      height={height}
    />
  );
}

/** Het volledige logo inclusief payoff — voor het inlogscherm en andere "voordeur"-schermen. */
export function BrandLogo({ width = 220 }: { width?: number }): React.JSX.Element {
  return (
    <img
      className="brand__logo"
      src={BRAND_ASSETS.logo}
      alt={`${BRAND_NAME} — ${BRAND_PAYOFF}`}
      width={width}
      height={Math.round(width / LOGO_RATIO)}
    />
  );
}
