import { useEffect, useRef } from 'react';

/**
 * Dialoogvenster (T17.2). Gebruikt voor handelingen die je *begint* vanaf een overzicht — een
 * gebruiker toevoegen, een begeleider aanmaken, een profiel importeren — zodat het overzicht zelf
 * niet volloopt met formulieren die je zelden nodig hebt.
 *
 * Toetsenbord- en schakelbediening zijn hier geen bijzaak (DESIGN §5.1): zolang de dialoog openstaat
 * blijft de focus erbinnen (Tab loopt rond), Escape sluit, en bij het sluiten gaat de focus terug
 * naar de knop die de dialoog opende — anders staat een schakelgebruiker na het sluiten weer
 * helemaal boven aan de pagina.
 *
 * `showTitle` staat uit voor inhoud die zelf al een kop draagt (de bestaande panelen); de dialoog
 * gebruikt de titel dan alleen als toegankelijke naam, zodat er geen dubbele kop in beeld staat.
 */
export function Modal({
  title,
  showTitle = true,
  onClose,
  children,
}: {
  /** Naam van de dialoog; ook wat een schermlezer voorleest bij het openen. */
  title: string;
  /** Toont de titel ook zichtbaar. Uit als de inhoud zijn eigen kop heeft. */
  showTitle?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);

  /*
   * Het element dat de focus had toen de dialoog verscheen — de knop die 'm opende.
   *
   * Bewust vastgelegd tijdens het hertekenen en niet in het effect hieronder. Onder `<StrictMode>`
   * draait React elk effect twee keer (mount → opruimen → mount); bij die tweede ronde stond de
   * focus al ín de dialoog, dus onthield het effect de dialoog zelf als "opener". Sluiten gaf de
   * focus dan aan een element dat net verwijderd was — en in de praktijk aan `body`.
   */
  const openerRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  // De laatste `onClose` in een ref. De effecten hieronder draaien bewust maar één keer (lege
  // dependency-lijst); zonder deze ref zouden ze de `onClose` van de eerste hertekening vasthouden.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /*
   * Focus naar binnen bij openen, terug naar de opener bij sluiten.
   *
   * Deze mag **niet** opnieuw draaien bij elke hertekening. Stond `onClose` in de dependency-lijst,
   * dan was dat precies wat er gebeurde: een `onClose={() => …}` is bij elke hertekening een nieuwe
   * functie, dus draaide de opruiming (focus terug naar de openende knop) en daarna het effect
   * (focus naar de dialoog) na élke toetsaanslag in een veld waarvan de waarde in de paginastate
   * staat. Je typte dan één letter en was het veld kwijt.
   */
  useEffect(() => {
    const opener = openerRef.current;
    // Focus naar de dialoog zelf: het eerste veld focussen zou de titel overslaan.
    dialogRef.current?.focus();
    return () => {
      if (!opener) return;
      // Niet meteen: zodra de dialoog uit de DOM verdwijnt zet de browser de focus zelf op `body`,
      // en dat gebeurt ná deze opruiming. Een `focus()` hier wordt daardoor overschreven — in
      // Firefox aantoonbaar. Daarom in de volgende beurt, als die verwijdering verwerkt is.
      queueMicrotask(() => {
        if (!opener.isConnected) return;
        // Heeft iets anders inmiddels de focus opgeëist, dan laten we die staan.
        const active = document.activeElement;
        if (active === null || active === document.body) opener.focus();
      });
    };
  }, []);

  // Escape sluit, en Tab blijft binnen de dialoog rondlopen.
  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  return (
    <div className="modal">
      {/* Klikvlak achter de dialoog. Bewust geen knop: Escape en de sluitknop zijn de
          toetsenbordwegen naar buiten, en een tweede "Sluiten" in de tabvolgorde is alleen maar in
          de weg. */}
      <div className="modal__scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={dialogRef}
      >
        <button className="modal__close" type="button" onClick={onClose} aria-label="Sluiten">
          <span aria-hidden="true">✕</span>
        </button>
        {showTitle ? <h2 className="modal__title">{title}</h2> : null}
        {children}
      </div>
    </div>
  );
}
