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

  it('laat een structureel tussenconcept aan het eind wél meetellen (T10.11)', () => {
    // Middenin valt "eten" weg ("Ik wil soep."), maar sluit de route erop af — de gebruiker rondde zelf
    // af met "Dit is genoeg" — dan is het de hele boodschap. Zonder deze regel bleef er "Ik wil iets
    // duidelijk maken." over, wat precies niets zegt.
    expect(
      generateMessage([
        { concept: 'want', label: 'Iets willen', category: 'intent' },
        { concept: 'eat', label: 'Eten' },
      ]),
    ).toBe('Ik wil eten.');

    expect(
      generateMessage([
        { concept: 'want', label: 'Iets willen', category: 'intent' },
        { concept: 'do-activity', label: 'Iets doen' },
      ]),
    ).toBe('Ik wil iets doen.');
  });

  it('laat het tussenconcept nog steeds weg als er een verfijning op volgt', () => {
    expect(
      generateMessage([
        { concept: 'want', label: 'Iets willen', category: 'intent' },
        { concept: 'eat', label: 'Eten' },
        { concept: 'soup', label: 'Soep' },
      ]),
    ).toBe('Ik wil soep.');
  });

  // --- T14.1: een vraagroute levert een vraag op ----------------------------------------------------

  describe('vraagroutes (T14.1)', () => {
    const ask: ChosenConcept = { concept: 'ask', label: 'Een vraag stellen', category: 'intent' };
    const wat: ChosenConcept = { concept: 'ask-what', label: 'Wat?', category: 'question' };
    const eten: ChosenConcept = { concept: 'eat', label: 'Eten', category: 'activity' };

    it('vormt de gemelde route tot een echte vraag', () => {
      // Zesde gebruikerstest: de gebruiker wilde "Wat eten we vandaag?" vragen en koos ❓ → ❔ Wat? →
      // 🍽️ Eten. Dat leverde letterlijk "Ik wil iets vragen over wat? eten." op — het vraagwoord werd als
      // lijdend voorwerp aan het wens-frame geplakt.
      expect(generateMessage([ask, wat, eten])).toBe('Wat eten we?');
    });

    it('neemt een tijdsbepaling vloeiend in de zin op', () => {
      const vandaag: ChosenConcept = { concept: 'today', label: 'Vandaag', category: 'time' };
      expect(generateMessage([ask, wat, eten, vandaag])).toBe('Wat eten we vandaag?');
    });

    it('zet een tweede inhoudelijk begrip er telegrafisch achter in plaats van er onzin van te maken', () => {
      // "Wat eten we brood?" is geen zin. Met een komma blijft het leesbaar én herleidbaar tot de
      // pictogrammen die de gebruiker aantikte.
      const brood: ChosenConcept = { concept: 'bread', label: 'Brood', category: 'food' };
      expect(generateMessage([ask, wat, eten, brood])).toBe('Wat eten we, brood?');
    });

    it('geeft ook zonder onderwerp een echte vraag', () => {
      expect(generateMessage([ask, wat])).toBe('Wat is dat?');
      expect(generateMessage([ask])).toBe('Ik wil een vraag stellen.');
    });

    it('gebruikt per vraagwoord de juiste vorm', () => {
      const q = (concept: string, label: string): ChosenConcept => ({
        concept,
        label,
        category: 'question',
      });
      const t = (concept: string, label: string, category: string): ChosenConcept => ({
        concept,
        label,
        category,
      });
      expect(generateMessage([ask, q('ask-who', 'Wie?'), t('mom', 'Mama', 'person')])).toBe(
        'Wie is mama?',
      );
      expect(generateMessage([ask, q('ask-where', 'Waar?'), t('toilet', 'Toilet', 'place')])).toBe(
        'Waar is het toilet?',
      );
      expect(
        generateMessage([ask, q('ask-when', 'Wanneer?'), t('outside', 'Buiten', 'place')]),
      ).toBe('Wanneer gaan we naar buiten?');
      expect(
        generateMessage([ask, q('ask-may', 'Mag ik?'), t('tv', 'Televisie', 'activity')]),
      ).toBe('Mag ik televisie kijken?');
    });

    it('laat het vraagwoord nooit als los woord in de zin staan', () => {
      // De kern van de fout: "…over **wat?** eten." Welke combinatie ook gekozen wordt, het vraagwoord
      // is het frame en mag nooit als inhoud meelopen.
      const vraagwoorden = ['ask-what', 'ask-who', 'ask-where', 'ask-when', 'ask-may'];
      const onderwerpen: ChosenConcept[] = [
        { concept: 'eat', label: 'Eten', category: 'activity' },
        { concept: 'mom', label: 'Mama', category: 'person' },
        { concept: 'toilet', label: 'Toilet', category: 'place' },
        { concept: 'onbekend-begrip', label: 'Onbekend begrip', category: 'object' },
      ];
      for (const woord of vraagwoorden) {
        for (const onderwerp of onderwerpen) {
          const zin = generateMessage([
            ask,
            { concept: woord, label: 'Vraagwoord?', category: 'question' },
            onderwerp,
          ]);
          expect(zin).toMatch(/\?$/);
          expect(zin[0]).toBe(zin[0]!.toUpperCase());
          expect(zin.toLowerCase()).not.toContain('vraagwoord');
          expect(zin).not.toContain('??');
        }
      }
    });

    it('raakt een wensroute niet aan', () => {
      const want: ChosenConcept = { concept: 'want', label: 'Iets willen', category: 'intent' };
      const brood: ChosenConcept = { concept: 'bread', label: 'Brood', category: 'food' };
      expect(generateMessage([want, eten, brood])).toBe('Ik wil brood.');
    });
  });
});
