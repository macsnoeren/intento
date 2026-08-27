import { StrictMode, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Modal } from './Modal.tsx';

/**
 * Tests voor het dialoogvenster (T17.2). De inhoud is per dialoog anders; wat hier getest wordt is
 * de bediening eromheen — die moet met toetsenbord en schakelbediening te doen zijn (DESIGN §5.1).
 */

/** Kleine testopstelling: een knop die de dialoog opent, zoals in de echte schermen. */
function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void } = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          onOpenChange?.(true);
        }}
      >
        Openen
      </button>
      {open ? (
        <Modal
          title="Gebruiker toevoegen"
          onClose={() => {
            setOpen(false);
            onOpenChange?.(false);
          }}
        >
          <input aria-label="Naam" />
          <button type="button">Opslaan</button>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * Opstelling waarin de *ouder* hertekent bij elke toetsaanslag — precies wat er gebeurt als het
 * invoerveld zijn waarde in de paginastate houdt ("Gebruiker toevoegen").
 */
function TypingHarness(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Openen
      </button>
      {open ? (
        <Modal title="Gebruiker toevoegen" onClose={() => setOpen(false)}>
          <input aria-label="Naam" value={value} onChange={(e) => setValue(e.target.value)} />
        </Modal>
      ) : null}
    </>
  );
}

describe('dialoogvenster', () => {
  it('draagt zijn titel als naam en toont die ook zichtbaar', () => {
    render(
      <Modal title="Gebruiker toevoegen" onClose={() => {}}>
        <p>inhoud</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Gebruiker toevoegen' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Gebruiker toevoegen' })).toBeTruthy();
  });

  it('laat de zichtbare titel weg als de inhoud zelf een kop draagt', () => {
    render(
      <Modal title="Begeleider aanmaken" showTitle={false} onClose={() => {}}>
        <section aria-label="Begeleider aanmaken">
          <h2>Begeleider aanmaken</h2>
        </section>
      </Modal>,
    );
    // Eén kop in beeld — die van de inhoud — maar de dialoog heeft wél een naam.
    expect(screen.getAllByRole('heading', { name: 'Begeleider aanmaken' })).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Begeleider aanmaken' })).toBeTruthy();
  });

  it('sluit met Escape, met de sluitknop en met een klik ernaast', () => {
    const closed: boolean[] = [];
    const { rerender } = render(<Harness onOpenChange={(open) => closed.push(open)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Openen' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Openen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sluiten' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<Harness onOpenChange={(open) => closed.push(open)} />);
    expect(closed.filter((open) => !open).length).toBeGreaterThanOrEqual(2);
  });

  it('zet de focus in de dialoog en geeft hem daarna terug aan de knop die hem opende', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Openen' });
    opener.focus();
    fireEvent.click(opener);

    // De dialoog zelf krijgt focus: zo leest een schermlezer eerst waar je bent beland.
    expect(document.activeElement).toBe(screen.getByRole('dialog'));

    fireEvent.keyDown(document, { key: 'Escape' });
    // Eén beurt later: de browser zet de focus zelf op `body` zodra de dialoog uit de DOM gaat, dus
    // het terugzetten gebeurt daarna. Zonder dit staat een schakelgebruiker na het sluiten weer
    // boven aan de pagina.
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('laat de focus in het veld staan tijdens het typen', () => {
    render(<TypingHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Openen' }));

    const input = screen.getByLabelText<HTMLInputElement>('Naam');
    input.focus();
    fireEvent.change(input, { target: { value: 'S' } });
    fireEvent.change(input, { target: { value: 'Sa' } });
    fireEvent.change(input, { target: { value: 'San' } });

    // De focusafhandeling mag niet opnieuw draaien bij elke hertekening van de ouder: dan sprong de
    // focus na elke letter uit het veld en was er niet meer in te typen.
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('San');
  });

  it('geeft de focus ook onder StrictMode terug aan de opener', async () => {
    // React draait onder <StrictMode> elk effect twee keer (mount → opruimen → mount). Wie de
    // openende knop in het effect vastlegt, onthoudt bij die tweede ronde de dialoog zelf — en geeft
    // de focus bij sluiten aan een element dat net verwijderd is. De app draait in StrictMode, dus
    // deze test draait dat na.
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    const opener = screen.getByRole('button', { name: 'Openen' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('houdt Tab binnen de dialoog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Openen' }));

    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Sluiten' });
    const save = screen.getByRole('button', { name: 'Opslaan' });

    // Vanaf het laatste element springt Tab terug naar het eerste, niet naar de pagina erachter.
    save.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    // En Shift+Tab vanaf de dialoog zelf gaat naar het laatste element.
    dialog.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
  });
});
