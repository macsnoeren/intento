import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SegmentedTabs, tabPanelProps, type SegmentedTab } from './SegmentedTabs.tsx';

/**
 * Tests voor de keuzebalk tussen de onderdelen van een scherm (T17.4). Het punt van deze component
 * is dat tab en paneel naar elkáár verwijzen: zonder die koppeling hoort een schermlezer wel een
 * rij knoppen, maar niet dat er inhoud bij hoort en waar je bent.
 */

type Tab = 'settings' | 'caregivers' | 'device';

const TABS: readonly SegmentedTab<Tab>[] = [
  { id: 'settings', label: 'Instellingen' },
  { id: 'caregivers', label: 'Begeleiders' },
  { id: 'device', label: 'Tablet' },
];

function Harness(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('settings');
  return (
    <>
      <SegmentedTabs
        label="Onderdelen van Sanne"
        prefix="user"
        tabs={TABS}
        active={tab}
        onSelect={setTab}
      />
      <div {...tabPanelProps('user', tab)}>Inhoud van {tab}</div>
    </>
  );
}

describe('keuzebalk tussen onderdelen', () => {
  it('toont elk onderdeel als tab, met het eerste geselecteerd', () => {
    render(<Harness />);
    const list = screen.getByRole('tablist', { name: 'Onderdelen van Sanne' });
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(list.textContent).toContain('Begeleiders');
    expect(screen.getByRole('tab', { name: 'Instellingen' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('wisselt van onderdeel en toont er één tegelijk', () => {
    render(<Harness />);
    expect(screen.getByRole('tabpanel').textContent).toContain('settings');

    fireEvent.click(screen.getByRole('tab', { name: 'Tablet' }));

    expect(screen.getByRole('tab', { name: 'Tablet' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Instellingen' }).getAttribute('aria-selected')).toBe(
      'false',
    );
    expect(screen.getByRole('tabpanel').textContent).toContain('device');
  });

  it('koppelt het paneel aan de tab die het toont', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'Begeleiders' }));

    const tab = screen.getByRole('tab', { name: 'Begeleiders' });
    // Het paneel is voor een schermlezer genoemd naar zijn tab, en de tab wijst terug.
    const panel = screen.getByRole('tabpanel', { name: 'Begeleiders' });
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.getAttribute('id'));
    expect(tab.getAttribute('aria-controls')).toBe(panel.getAttribute('id'));
  });
});
