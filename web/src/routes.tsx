import { App } from './App.tsx';
import { TabletApp } from './TabletApp.tsx';
import { OperatorConsole } from './OperatorConsole.tsx';

/**
 * Route-dispatch van de web-bundel: drie losse interfaces achter één build, elk op een eigen pad.
 *
 * - `/tablet` — de **gebruikersapp** (device-auth, eigen gebruiker); start direct in de gespreksflow
 *   (T4.2).
 * - `/operator` — de **platform-operatorconsole** (T8.3): het enige deel dat over tenants heen kijkt.
 *   Bewust een aparte routetak i.p.v. een tab in het beheer, zodat er geen knop "cross-tenant" naast
 *   je eigen organisatie staat; een operator vindt 'm via één expliciete link op "Mijn account".
 * - de overige paden — de **beheeromgeving** (account-auth, altijd tenant-gefilterd).
 *
 * Staat los van `main.tsx` (die mount en dus side effects heeft) zodat de dispatch zelf testbaar is:
 * een typo hier laat een interface stilletjes op de verkeerde uitkomen, zonder foutmelding.
 */
export function routeFor(pathname: string): React.JSX.Element {
  const path = pathname.replace(/\/+$/, '');
  if (path.endsWith('/tablet')) return <TabletApp />;
  if (path.endsWith('/operator')) return <OperatorConsole />;
  return <App />;
}
