import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';

describe('App-shell', () => {
  it('rendert de titel en tagline', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Intento' })).toBeTruthy();
    expect(screen.getByText('Wat probeer je duidelijk te maken?')).toBeTruthy();
  });
});
