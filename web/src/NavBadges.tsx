import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';

/**
 * Tellers in het menu (N9.3, INTENTO-NEW-DESIGN §17): nu alleen het aantal open ontbrekende woorden
 * bij "Ontbrekende woorden". De beheerder ziet zo zonder te zoeken dat er iets te doen is. De teller
 * wordt opgehaald bij elke paginawissel; een pagina die het aantal verandert, roept `refresh()` aan.
 * Lukt het ophalen niet, dan staat er gewoon geen teller (het menu werkt altijd).
 */

interface NavBadges {
  counts: Partial<Record<AdminView, number>>;
  refresh: () => void;
}

const NavBadgesContext = createContext<NavBadges>({ counts: {}, refresh: () => {} });

export function useNavBadges(): NavBadges {
  return useContext(NavBadgesContext);
}

export function NavBadgesProvider({
  api,
  view,
  children,
}: {
  api: Api;
  /** De huidige pagina: bij elke wissel opnieuw tellen. */
  view: AdminView;
  children: React.ReactNode;
}): React.JSX.Element {
  const [gaps, setGaps] = useState<number | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    api
      .getVocabularyGapCount()
      .then(({ open }) => {
        if (active) setGaps(open);
      })
      .catch(() => {
        if (active) setGaps(undefined);
      });
    return () => {
      active = false;
    };
  }, [api, view, tick]);

  return (
    <NavBadgesContext.Provider value={{ counts: { gaps }, refresh }}>
      {children}
    </NavBadgesContext.Provider>
  );
}
