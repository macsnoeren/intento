import { useRef, useState } from 'react';
import type { UserPublic } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Profielexport/-import in de beheeromgeving (T8.1, DESIGN §6.4, §8.2, FR-019).
 *
 * Gegevenseigenaarschap (DESIGN §4): een beheerder kan het volledige communicatieprofiel van een gebruiker
 * als **versleuteld** bestand downloaden (`ProfileExportPanel`, per gebruiker) en elders weer importeren als
 * nieuwe gebruiker (`ProfileImportPanel`, op paginaniveau — import maakt immers een nieuwe gebruiker aan).
 * Het bestand is onleesbaar zonder de omgevingssleutel; de client leest/schrijft alleen de ondoorzichtige
 * payload en praat nooit rechtstreeks met de db (DESIGN §8.1).
 */

/** Triggert een browserdownload van een tekstbestand (de versleutelde export-payload). */
function downloadTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Exportknop voor één geselecteerde gebruiker. */
export function ProfileExportPanel({
  api,
  userId,
  userName,
}: {
  api: Api;
  userId: string;
  userName: string;
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleExport(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const { data, filename } = await api.exportProfile(userId);
      downloadTextFile(filename, data);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Exporteren mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label={`Profiel exporteren voor ${userName}`}>
      <h2 className="panel__subtitle">Profiel exporteren</h2>
      <p className="muted">
        Download het communicatieprofiel, de persoonlijke context en de voorkeuren als versleuteld
        bestand. Account- en organisatiegegevens gaan niet mee.
      </p>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        className="button button--primary"
        type="button"
        onClick={() => void handleExport()}
        disabled={busy}
      >
        Profiel exporteren
      </button>
    </section>
  );
}

/** Importpaneel: kies een exportbestand → nieuwe gebruiker in de eigen organisatie. */
export function ProfileImportPanel({
  api,
  onImported,
}: {
  api: Api;
  onImported: (user: UserPublic) => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File): Promise<void> {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const data = (await file.text()).trim();
      const user = await api.importProfile({ data });
      setStatus(`Profiel geïmporteerd als "${user.name}".`);
      onImported(user);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Importeren mislukt.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section className="panel" aria-label="Profiel importeren">
      <h2 className="panel__subtitle">Profiel importeren</h2>
      <p className="muted">
        Kies een eerder geëxporteerd profielbestand. Er wordt een nieuwe gebruiker met dat profiel
        aangemaakt in deze organisatie.
      </p>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="muted" role="status">
          {status}
        </p>
      ) : null}

      <input
        ref={inputRef}
        className="field__input"
        type="file"
        aria-label="Profielbestand kiezen"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </section>
  );
}
