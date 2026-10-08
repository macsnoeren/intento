import { useEffect, useState } from 'react';
import type { AccountPublic, BiasReport, BiasShare, UserPublic } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import { AppShell } from './AppShell.tsx';
import type { AdminView } from './AdminNav.tsx';

/**
 * Het bias-rapport voor de beheerder (N14.3, INTENTO-NEW-DESIGN §24 B4/B5, §25).
 *
 * Laat zien hoe sterk de plek op het scherm en de vorm de keuzes kunnen sturen: kiest iemand vaak wat
 * bovenaan staat, zegt hij vaak JA, kiest hij vaak het contact dat eerst werd aangeboden? Plus hoe vaak
 * Intento van vorm wisselde, hoeveel woorden ontbreken en hoe vaak Intento te zeker was. Het rapport
 * oordeelt niet: bij elk getal staat in gewone taal wat het kan betekenen.
 */

const PERIODS = [
  { value: '', label: 'Alles binnen de bewaartermijn' },
  { value: '30', label: 'Laatste 30 dagen' },
  { value: '7', label: 'Laatste 7 dagen' },
] as const;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** "62% (8 van 13 keuzes)", of "nog niets te tellen". */
function shareText(value: BiasShare, unit: string): string {
  if (value.share === null) return 'Nog niets te tellen.';
  return `${pct(value.share)} (${value.count} van ${value.of} ${unit})`;
}

export function BiasReportPage({
  api,
  account,
  onLogout,
  onNavigate,
}: {
  api: Api;
  account: AccountPublic;
  onLogout: () => void;
  onNavigate: (view: AdminView) => void;
}): React.JSX.Element {
  const [days, setDays] = useState('');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [report, setReport] = useState<BiasReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .listUsers()
      .then((loaded) => {
        if (active) setUsers(loaded.users);
      })
      .catch(() => {
        // Zonder lijst kan het rapport nog steeds over de hele organisatie.
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    let active = true;
    setError(null);
    api
      .getBiasReport({
        ...(days ? { days: Number(days) } : {}),
        ...(userId ? { userId } : {}),
      })
      .then((loaded) => {
        if (active) setReport(loaded);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      });
    return () => {
      active = false;
    };
  }, [api, days, userId]);

  return (
    <AppShell
      account={account}
      title="Bias-rapport"
      subtitle="Hoe sterk de plek op het scherm en de vorm de keuzes kunnen sturen. Het rapport oordeelt niet."
      active="bias"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <div className="toolbar">
        <label className="field">
          <span className="field__label">Periode</span>
          <select className="field__input" value={days} onChange={(e) => setDays(e.target.value)}>
            {PERIODS.map((period) => (
              <option key={period.value} value={period.value}>
                {period.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Gebruiker</span>
          <select
            className="field__input"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">Iedereen</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {report === null && !error ? <p className="muted">Laden…</p> : null}

      {report ? (
        <section className="panel" aria-label="Bias-rapport">
          <p className="muted" role="status">
            Over {report.sessions === 1 ? '1 gesprek' : `${report.sessions} gesprekken`}.
          </p>
          <dl className="definition-list">
            <dt>Eerste plek bij tegels</dt>
            <dd>
              {shareText(report.firstPosition, 'keuzes')}
              {report.firstPosition.expected !== null
                ? ` · bij toeval ongeveer ${pct(report.firstPosition.expected)}`
                : ''}
              <small className="choice-block__hint">
                Ligt dit ver boven toeval, dan kiest iemand misschien vaak wat bovenaan staat. De
                volgorde stuurt dan mee.
              </small>
            </dd>

            <dt>JA bij ja/nee-vragen</dt>
            <dd>
              {shareText(report.binaryYes, 'antwoorden')}
              <small className="choice-block__hint">
                Wie moeite heeft met kiezen, zegt vaker JA op wat er staat. Een hoog aandeel kan
                daarop wijzen.
              </small>
            </dd>

            <dt>Contact dat eerst werd aangeboden</dt>
            <dd>
              {shareText(report.contactFirst, 'verzendingen')}
              {report.contacts.length > 0 ? (
                <ul className="review-turn__options" aria-label="Per contact">
                  {report.contacts.map((contact) => (
                    <li key={contact.contactId}>
                      {contact.name ?? 'Verwijderd contact'}: {contact.chosen} keer gekozen, waarvan{' '}
                      {contact.chosenAtFirst} keer als eerste aangeboden
                    </li>
                  ))}
                </ul>
              ) : null}
              <small className="choice-block__hint">
                Wie het vaakst gekozen wordt, komt eerst. Gaat bijna alles naar het eerste contact,
                dan kan die volgorde zichzelf versterken.
              </small>
            </dd>

            <dt>Vormwisselingen</dt>
            <dd>
              {report.modeSwitches.switches === 1
                ? '1 wissel'
                : `${report.modeSwitches.switches} wissels`}{' '}
              in{' '}
              {report.modeSwitches.sessions === 1
                ? '1 gesprek'
                : `${report.modeSwitches.sessions} gesprekken`}
              <small className="choice-block__hint">
                Alleen bij "Laat Intento kiezen". Veel wissels kunnen betekenen dat geen van beide
                vormen goed past.
              </small>
            </dd>

            <dt>Ontbrekende woorden</dt>
            <dd>
              {report.gaps.open} open van {report.gaps.total}
              <small className="choice-block__hint">
                Voor de hele organisatie, niet per periode of gebruiker.
              </small>
            </dd>

            <dt>Te zeker</dt>
            <dd>
              {report.overconfidence.rejectedConfidentProposals.share === null
                ? 'Geen voorstellen met 90% zekerheid of meer.'
                : `${report.overconfidence.rejectedConfidentProposals.count} van ${report.overconfidence.rejectedConfidentProposals.of} voorstellen met 90% zekerheid of meer kregen NEE`}
              {' · '}
              {report.overconfidence.suddenRises === 1
                ? '1 keer'
                : `${report.overconfidence.suddenRises} keer`}{' '}
              steeg de zekerheid plots zonder JA
              <small className="choice-block__hint">
                Intento was dan zekerder dan de antwoorden rechtvaardigden.
              </small>
            </dd>
          </dl>
        </section>
      ) : null}
    </AppShell>
  );
}
