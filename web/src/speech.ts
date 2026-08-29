import { isDeviceVoice } from '@intento/shared';

/**
 * Spraakuitvoer in de browser (T18.3, DESIGN §5.1, §5.4).
 *
 * De tablet spreekt uit **wat er op het scherm staat** — letterlijk en ongewijzigd. Deze laag weet
 * daar verder niets van; ze krijgt zinnen en zorgt dat ze in de juiste volgorde te horen zijn.
 *
 * Twee bronnen, in deze volgorde:
 *  1. **De spraakdienst** via de backend (`speakText`): overal dezelfde stem, ook op een apparaat
 *     zonder Nederlandse stem.
 *  2. **Het apparaat zelf** (`speechSynthesis`): de keuze "Stem van het apparaat", en tevens het
 *     vangnet als de server onbereikbaar is. Beter een minder mooie stem dan stilte.
 *
 * `SpeechPort` is bewust een smalle interface, zodat tests kunnen controleren wát er uitgesproken
 * wordt zonder een audio-element in jsdom (dat daar niet speelt).
 */
export interface SpeechPort {
  /**
   * Spreekt één tekst uit, of meerdere ná elkaar. Een nieuwe aanroep breekt af wat er nog loopt: op
   * een nieuw scherm hoort de vorige zin te stoppen, niet eroverheen te stapelen.
   */
  speak(text: string | readonly string[]): void;
  /** Stopt onmiddellijk (bv. bij het verlaten van een scherm). */
  stop(): void;
  /**
   * Ontgrendelt het geluid. Safari op iOS staat geluid pas toe ná een aanraking; deze aanroep hoort
   * dus in een echte klik-/tikafhandelaar thuis. Daarna mag de app ook uit zichzelf spreken.
   */
  unlock(): void;
}

/** Een spraakpoort die niets doet — als spraak uitstaat voor deze gebruiker. */
export const silentSpeech: SpeechPort = {
  speak: () => {},
  stop: () => {},
  unlock: () => {},
};

export interface BrowserSpeechOptions {
  /** De gekozen stem uit het communicatieprofiel; `device` betekent: de tablet spreekt zelf. */
  voice: string;
  /** Haalt audio op bij de backend. Ontbreekt hij, dan spreekt alleen het apparaat. */
  fetchAudio?: (text: string) => Promise<Blob>;
}

/**
 * Bouwt de echte spraakpoort van de browser.
 *
 * Waarom een eigen wachtrij en niet gewoon `Audio.play()` per zin: de tablet spreekt soms twee dingen
 * na elkaar (de vraag, en daarna een bedieningszetje uit T18.4). Die moeten in volgorde klinken en
 * samen afgebroken kunnen worden. Een teller (`generation`) merkt of er intussen iets nieuws gevraagd
 * is, zodat een traag opgehaald fragment niet alsnog over het volgende scherm heen valt.
 */
export function createBrowserSpeech({ voice, fetchAudio }: BrowserSpeechOptions): SpeechPort {
  const audio = typeof Audio === 'undefined' ? null : new Audio();
  const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
  const opgehaald = new Map<string, string>();
  let generation = 0;
  let unlocked = false;

  function stopAlles(): void {
    generation += 1;
    audio?.pause();
    synth?.cancel();
  }

  /** Laat het apparaat zelf spreken (keuze `device`, of vangnet als de server niets levert). */
  function spreekMetApparaat(text: string): Promise<void> {
    if (!synth) return Promise.resolve();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'nl-NL';
      // Ook bij een fout doorgaan: de volgende zin is belangrijker dan deze.
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      synth.speak(utterance);
    });
  }

  /** Speelt een fragment van de spraakdienst af; geeft `false` als dat niet lukte. */
  async function spreekMetServer(text: string, mijn: number): Promise<boolean> {
    if (!fetchAudio || !audio) return false;
    try {
      let url = opgehaald.get(text);
      if (!url) {
        const blob = await fetchAudio(text);
        url = URL.createObjectURL(blob);
        opgehaald.set(text, url);
      }
      // Tussen ophalen en afspelen kan het scherm al veranderd zijn.
      if (mijn !== generation) return true;
      audio.src = url;
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
      return true;
    } catch (err) {
      // Niet stil terugvallen. Een mislukking hier is precies wat de gebruiker hoort als "hij pakt mijn
      // stem niet": een 403 omdat spraak uitstaat, een onbereikbare backend, of een browser die het
      // geluid nog niet toestaat. Zonder dit spoor is van buitenaf niet te zien wélke van de drie het is.
      console.warn('[intento] serverstem mislukt, terug naar de stem van het apparaat:', err);
      return false;
    }
  }

  return {
    stop: stopAlles,

    unlock(): void {
      if (unlocked) return;
      unlocked = true;
      // Eén stil fragment binnen de tik: daarna beschouwt iOS het geluid als toegestaan.
      if (audio) {
        audio.muted = true;
        void audio
          .play()
          .then(() => {
            audio.pause();
            audio.muted = false;
          })
          .catch(() => {
            audio.muted = false;
          });
      }
      if (synth) synth.speak(new SpeechSynthesisUtterance(''));
    },

    speak(text: string | readonly string[]): void {
      const zinnen = (typeof text === 'string' ? [text] : text)
        .map((zin) => zin.trim())
        .filter((zin) => zin.length > 0);
      if (zinnen.length === 0) return;

      stopAlles();
      const mijn = generation;
      void (async () => {
        for (const zin of zinnen) {
          if (mijn !== generation) return;
          const gelukt = isDeviceVoice(voice) ? false : await spreekMetServer(zin, mijn);
          if (mijn !== generation) return;
          if (!gelukt) await spreekMetApparaat(zin);
        }
      })();
    },
  };
}

/**
 * Speelt een fragment van de spraakdienst af (T18.2, beheeromgeving). Losse functie, zodat de
 * beheer-UI een stem kan laten horen zonder de hele spraakpoort van de tablet op te tuigen.
 */
export async function playAudioBlob(blob: Blob): Promise<void> {
  if (typeof Audio === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  try {
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Laat het **huidige apparaat** een zin uitspreken (T18.2). Gebruikt bij het beluisteren van de keuze
 * "Stem van het apparaat": op de computer van de begeleider klinkt dan de stem van díé computer — een
 * indicatie, geen belofte, want de tablet heeft zijn eigen stemmen.
 */
export function speakWithDeviceVoice(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'nl-NL';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
