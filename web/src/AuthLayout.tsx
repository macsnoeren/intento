import { BrandLogo } from './Brand.tsx';

/**
 * De "voordeur"-schermen: inloggen, aanmelden, e-mailadres bevestigen, en de blokkerende schermen
 * die daarop lijken (T17.1). Eén rustige, gecentreerde kaart met het logo erboven.
 *
 * Waarom het logo hier groot mag: dit is het enige moment waarop iemand nog niet in de app zit. Wie
 * een link uit een mail volgt of een gedeelde tablet aanzet, moet in één oogopslag zien wáár hij
 * inlogt — daarna is een klein beeldmerk in de kopbalk genoeg.
 */
export function AuthLayout({
  title,
  intro,
  children,
}: {
  title: string;
  /** Eén regel onder de titel die uitlegt wat er van iemand verwacht wordt. */
  intro?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="auth">
      <main className="auth__card">
        <div className="auth__brand">
          <BrandLogo width={200} />
        </div>
        <h1 className="auth__title">{title}</h1>
        {intro ? <p className="auth__intro">{intro}</p> : null}
        {children}
      </main>
    </div>
  );
}
