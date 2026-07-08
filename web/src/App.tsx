/**
 * Lege tablet-first shell (fase 0). Nog geen communicatieflow; alleen bewijs dat
 * de web-app rendert en de gedeelde types importeerbaar zijn. De echte
 * gebruikersapp, begeleiderinterface en beheeromgeving komen in latere fases.
 */
export function App(): React.JSX.Element {
  return (
    <main className="app-shell">
      <h1 className="app-shell__title">Intento</h1>
      <p className="app-shell__tagline">Wat probeer je duidelijk te maken?</p>
      <p className="app-shell__status">Fundament opgezet — communicatieflow volgt.</p>
    </main>
  );
}
