import { describe, expect, it } from 'vitest';
import { routeFor } from './routes.tsx';
import { App } from './App.tsx';
import { TabletApp } from './TabletApp.tsx';
import { OperatorConsole } from './OperatorConsole.tsx';

/**
 * Route-dispatch van de bundel (T4.2, T8.3). Drie interfaces achter één build, gekozen op het pad.
 * Bewust getest: een typo hier laat de tablet of de operatorconsole stilletjes op de beheeromgeving
 * uitkomen — geen foutmelding, gewoon het verkeerde scherm.
 */
describe('routeFor', () => {
  it('kiest de gebruikersapp op /tablet', () => {
    expect(routeFor('/tablet').type).toBe(TabletApp);
    expect(routeFor('/tablet/').type).toBe(TabletApp);
  });

  it('kiest de operatorconsole op /operator', () => {
    expect(routeFor('/operator').type).toBe(OperatorConsole);
    expect(routeFor('/operator/').type).toBe(OperatorConsole);
  });

  it('kiest de beheeromgeving op elk ander pad', () => {
    expect(routeFor('/').type).toBe(App);
    expect(routeFor('/verify-email').type).toBe(App);
    // Geen losse prefix-match: iets dat er alleen op lijkt hoort niet in de console te belanden.
    expect(routeFor('/operator-handleiding').type).toBe(App);
  });
});
