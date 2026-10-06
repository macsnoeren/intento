import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  turnRequestSchema,
  turnResponseSchema,
  type PresentationOption,
  type TurnRequest,
  type TurnResponse,
} from '@intento/shared';
import {
  InvariantViolationError,
  assertTurnResponse,
  checkTurnResponse,
  type InvariantId,
} from './invariants.js';

/** Harde invarianten I1, I4, I5, I6, I7 (N4.4, INTENTO-NEW-DESIGN §52): per invariant geldig en ongeldig. */

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'contracts',
  'fixtures',
  'valid',
);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
}

function startRequest(change?: (request: TurnRequest) => void): TurnRequest {
  const request = turnRequestSchema.parse(fixture('turn_request.start'));
  change?.(request);
  return request;
}

function answerRequest(change?: (request: TurnRequest) => void): TurnRequest {
  const request = turnRequestSchema.parse(fixture('turn_request.answer_yes'));
  change?.(request);
  return request;
}

function response(name: string, change?: (response: TurnResponse) => void): TurnResponse {
  const parsed = turnResponseSchema.parse(fixture(name));
  change?.(parsed);
  return parsed;
}

function invariants(request: TurnRequest, res: TurnResponse): InvariantId[] {
  return checkTurnResponse(request, res).map((violation) => violation.invariant);
}

function symbol(id: string, label: string, concept: string, position: number): PresentationOption {
  return {
    ref: id,
    kind: 'symbol',
    vocabulary_item_id: id,
    contact_id: null,
    label,
    concept,
    representation: 'exact',
    position,
  };
}

describe('harde invarianten', () => {
  it('laat de geldige voorbeeldantwoorden door', () => {
    expect(checkTurnResponse(startRequest(), response('turn_response.question'))).toEqual([]);
    expect(checkTurnResponse(startRequest(), response('turn_response.stand_in'))).toEqual([]);
    expect(
      checkTurnResponse(
        answerRequest((r) => {
          r.turn = 1;
        }),
        response('turn_response.confirm_message'),
      ),
    ).toEqual([]);
    expect(
      checkTurnResponse(
        startRequest((r) => {
          r.settings.interaction_mode = 'multi';
        }),
        response('turn_response.multi'),
      ),
    ).toEqual([]);
  });

  describe('I1 — alleen symbolen uit de Vocabulary en contacten van deze gebruiker', () => {
    it('verwerpt een symbool dat niet in de Vocabulary staat', () => {
      const res = response('turn_response.question', (r) => {
        r.presentation.options = [symbol('v-verzonnen', 'pijn', 'pain', 0)];
      });
      expect(invariants(startRequest(), res)).toEqual(['I1']);
    });

    it('verwerpt een exact symbool met een ander woord of concept', () => {
      const res = response('turn_response.question', (r) => {
        r.presentation.options = [symbol('v-pain', 'hoofdpijn', 'headache', 0)];
      });
      expect(invariants(startRequest(), res)).toEqual(['I1', 'I1']);
      // Een synoniem van het item zelf is wel goed.
      const synonym = response('turn_response.question', (r) => {
        r.presentation.options = [symbol('v-sick', 'Misselijk', 'sick', 0)];
      });
      expect(invariants(startRequest(), synonym)).toEqual([]);
    });

    it('verwerpt een contact buiten een deelfase of van een ander', () => {
      const contactOption: PresentationOption = {
        ref: 'c-1',
        kind: 'contact',
        vocabulary_item_id: null,
        contact_id: 'c-1',
        label: 'Mama',
        concept: null,
        representation: 'exact',
        position: 0,
      };
      const inQuestion = response('turn_response.question', (r) => {
        r.presentation.options = [contactOption];
      });
      expect(invariants(answerRequest(), inQuestion)).toContain('I1');

      const shareOwn = response('turn_response.question', (r) => {
        r.presentation.kind = 'share_contact';
        r.presentation.options = [contactOption];
      });
      expect(invariants(answerRequest(), shareOwn)).toEqual([]);

      const shareOther = response('turn_response.question', (r) => {
        r.presentation.kind = 'share_contact';
        r.presentation.options = [{ ...contactOption, ref: 'c-ander', contact_id: 'c-ander' }];
      });
      expect(invariants(answerRequest(), shareOther)).toEqual(['I1']);
    });

    it('verwerpt een gap met een pictogram buiten de Vocabulary', () => {
      const res = response('turn_response.stand_in', (r) => {
        const gap = r.gaps[0];
        if (gap) gap.best_available_item_id = 'v-onbekend';
      });
      expect(invariants(startRequest(), res)).toContain('I1');
    });
  });

  describe('I4 — aantal opties', () => {
    it('verwerpt binary met twee opties of zonder optie', () => {
      const two = response('turn_response.question', (r) => {
        r.presentation.options = [
          symbol('v-pain', 'pijn', 'pain', 0),
          symbol('v-eat', 'eten', 'eat', 1),
        ];
      });
      expect(invariants(startRequest(), two)).toEqual(['I4']);
      const none = response('turn_response.question', (r) => {
        r.presentation.options = [];
      });
      expect(invariants(startRequest(), none)).toEqual(['I4']);
    });

    it('verwerpt multi-icon met één, te veel of dubbele opties', () => {
      const multi = (r: TurnRequest): void => {
        r.settings.interaction_mode = 'multi';
        r.settings.options_per_screen = 2;
      };
      const one = response('turn_response.multi', (r) => {
        r.presentation.options = [symbol('v-head', 'hoofd', 'head', 0)];
      });
      expect(invariants(startRequest(multi), one)).toEqual(['I4']);

      const three = response('turn_response.multi', (r) => {
        r.presentation.options.push(symbol('v-eat', 'eten', 'eat', 2));
      });
      expect(invariants(startRequest(multi), three)).toEqual(['I4']);

      const double = response('turn_response.multi', (r) => {
        r.presentation.options = [
          symbol('v-head', 'hoofd', 'head', 0),
          { ...symbol('v-head', 'hoofd', 'head', 1), ref: 'v-head-2' },
        ];
      });
      expect(invariants(startRequest(multi), double)).toEqual(['I4']);
    });

    it('verwerpt dubbele refs en gaten in de posities', () => {
      const res = response('turn_response.question', (r) => {
        r.presentation.options = [symbol('v-pain', 'pijn', 'pain', 3)];
      });
      expect(invariants(startRequest(), res)).toEqual(['I4']);
    });
  });

  describe('I5 — stand-in alleen met een gap', () => {
    it('verwerpt een stand-in zonder gap', () => {
      const res = response('turn_response.stand_in', (r) => {
        r.gaps = [];
      });
      expect(invariants(startRequest(), res)).toEqual(['I5']);
    });

    it('verwerpt een gap voor een ander pictogram', () => {
      const res = response('turn_response.stand_in', (r) => {
        const gap = r.gaps[0];
        if (gap) gap.best_available_item_id = 'v-head';
      });
      expect(invariants(startRequest(), res)).toEqual(['I5']);
    });
  });

  describe('I6 — "Bedoel je …?" pas na een antwoord', () => {
    it('verwerpt een voorstel als eerste scherm', () => {
      const res = response('turn_response.confirm_message', (r) => {
        r.turn = 0;
      });
      expect(invariants(startRequest(), res)).toEqual(['I6']);
    });

    it('vertrouwt niet op antwoorden die de agent zelf in de state zet', () => {
      // `confirm_message`-fixture heeft één antwoord in state; bij een start telt dat niet.
      const res = response('turn_response.confirm_message', (r) => {
        r.turn = 0;
        r.state.answers = [{ turn: 0, answer: 'yes', concepts: ['pain'], option_ref: 'v-pain' }];
      });
      expect(invariants(startRequest(), res)).toEqual(['I6']);
    });
  });

  describe('I7 — vorm wisselen', () => {
    it('verwerpt een andere vorm dan ingesteld', () => {
      // Ingesteld op binary, de agent toont multi-icon.
      expect(invariants(startRequest(), response('turn_response.multi'))).toEqual(['I7']);
    });

    it('verwerpt een scherm in een andere vorm dan het gesprek', () => {
      const res = response('turn_response.question', (r) => {
        r.state.interaction_mode = 'multi';
      });
      expect(
        invariants(
          startRequest((q) => {
            q.settings.interaction_mode = 'ai';
          }),
          res,
        ),
      ).toEqual(['I7']);
    });

    it('bij "AI kiest": geen wissel binnen 3 beurten, wel daarna', () => {
      const request = (turn: number): TurnRequest =>
        answerRequest((r) => {
          r.turn = turn;
          r.settings.interaction_mode = 'ai';
          r.settings.options_per_screen = 2;
          if (r.state) {
            r.state.interaction_mode = 'binary';
            r.state.mode_since_turn = 0;
          }
        });
      const switched = (turn: number): TurnResponse =>
        response('turn_response.multi', (r) => {
          r.turn = turn;
          r.state.mode_since_turn = turn;
        });

      expect(invariants(request(2), switched(2))).toEqual(['I7']);
      expect(invariants(request(3), switched(3))).toEqual([]);

      // Wisselen zonder de klok te zetten mag niet; de klok verzetten zonder wissel ook niet.
      const noClock = response('turn_response.multi', (r) => {
        r.turn = 3;
        r.state.mode_since_turn = 0;
      });
      expect(invariants(request(3), noClock)).toEqual(['I7']);
      const resetClock = response('turn_response.question', (r) => {
        r.turn = 3;
        r.state.mode_since_turn = 3;
      });
      expect(invariants(request(3), resetClock)).toEqual(['I7']);
    });
  });

  it('assertTurnResponse gooit met alle schendingen', () => {
    const res = response('turn_response.stand_in', (r) => {
      r.gaps = [];
      r.presentation.options.push(symbol('v-pain', 'pijn', 'pain', 1));
    });
    expect(() => assertTurnResponse(startRequest(), res)).toThrow(InvariantViolationError);
    try {
      assertTurnResponse(startRequest(), res);
    } catch (error) {
      expect(error instanceof InvariantViolationError && error.violations.length).toBe(2);
      // De reden noemt geen woorden van het scherm.
      expect(error instanceof Error && error.message).not.toContain('duizelig');
    }
  });
});
