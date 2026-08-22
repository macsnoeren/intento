import { describe, expect, it } from 'vitest';
import { generateMessage, type ChosenConcept } from './message.js';

/**
 * Gescripte zinsvorming (T4.3, herzien in T10.9; DESIGN §7.1 taak 4, §7.8).
 *
 * De sjabloon-zin is de veilige bodem onder `/generate` en `/confirm`: hij is deterministisch en blijft
 * per constructie binnen de gekozen concepten. Sinds de AI ook op het startscherm een concept mag
 * aandragen (T10.6) hoeft een route niet meer met een intentie te beginnen — en dat is precies wat hier
 * misging: route `nagelknipper` leverde de bevestigde boodschap "Nagelknipper." op, één los woord.
 */
describe('generateMessage — zinsframes', () => {
  it('vormt de intentie-route uit DESIGN §3.1', () => {
    const route: ChosenConcept[] = [
      { concept: 'want', label: 'Iets willen', category: 'intent' },
      { concept: 'do-activity', label: 'Iets doen', category: 'activity' },
      { concept: 'outside', label: 'Buiten', category: 'place' },
      { concept: 'walking', label: 'Wandelen', category: 'activity' },
      { concept: 'dog', label: 'Hond', category: 'animal' },
    ];
    expect(generateMessage(route)).toBe('Ik wil buiten wandelen met mijn hond.');
  });

  it('valt terug op de intentie-zin zonder verfijning', () => {
    expect(generateMessage([{ concept: 'want', label: 'Iets willen', category: 'intent' }])).toBe(
      'Ik wil iets duidelijk maken.',
    );
  });

  it('levert een lopende zin voor een route die met een AI-aangedragen concept begint (T10.9)', () => {
    // Reproductie van de rooktest: één concept, geen intentie. Vroeger: "Nagelknipper."
    const route: ChosenConcept[] = [
      { concept: 'nagelknipper', label: 'Nagelknipper', category: 'object' },
    ];
    const message = generateMessage(route);
    expect(message).toBe('Ik wil iets zeggen over nagelknipper.');
    // Een zin, geen los woord: onderwerp + persoonsvorm.
    expect(message.split(' ').length).toBeGreaterThan(2);
  });

  it('houdt alle concepten van een route zonder intentie als inhoud (er gaat er geen verloren)', () => {
    const route: ChosenConcept[] = [
      { concept: 'nagelknipper', label: 'Nagelknipper', category: 'object' },
      { concept: 'pain', label: 'Pijn', category: 'problem' },
    ];
    expect(generateMessage(route)).toBe('Ik wil iets zeggen over nagelknipper pijn.');
  });

  it('gebruikt de categorie, niet het toeval dat we een frame kennen', () => {
    // Een nieuwe intentiecategorie zonder eigen frame blijft een intentie: generieke intentie-terugval.
    const route: ChosenConcept[] = [
      { concept: 'greet', label: 'Groeten', category: 'intent' },
      { concept: 'mom', label: 'Mama', category: 'person' },
    ];
    expect(generateMessage(route)).toBe('Ik wil met mama.');
  });

  it('leidt de intentie af uit het concept als de categorie ontbreekt (oudere aanroepers)', () => {
    expect(
      generateMessage([
        { concept: 'feel', label: 'Hoe ik mij voel' },
        { concept: 'happy', label: 'Blij' },
      ]),
    ).toBe('Ik voel me blij.');
  });

  it('weigert een lege route', () => {
    expect(() => generateMessage([])).toThrow();
  });
});
