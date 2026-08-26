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

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus naar de dialoog zelf: het eerste veld focussen zou de titel overslaan.
    dialogRef.current?.focus();

    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
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
      opener?.focus();
    };
  }, [onClose]);

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
