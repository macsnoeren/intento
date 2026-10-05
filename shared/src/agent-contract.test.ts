import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z, type ZodType } from 'zod';
import { turnRequestSchema, turnResponseSchema } from './agent-contract.js';

/**
 * De zod-contracten tegen dezelfde voorbeeldbestanden als pydantic (N1.4, INTENTO-NEW-DESIGN §34).
 * Een bestand heet `<model>.<naam>.json`; het voorvoegsel bepaalt het model. Elk geldig voorbeeld
 * moet worden geaccepteerd en elk ongeldig voorbeeld geweigerd — precies zoals aan de Python-kant.
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'fixtures');

const MODELS: Record<string, ZodType> = {
  turn_request: turnRequestSchema,
  turn_response: turnResponseSchema,
};

function load(kind: 'valid' | 'invalid'): { name: string; schema: ZodType; data: unknown }[] {
  const files = readdirSync(join(FIXTURES, kind)).filter((name) => name.endsWith('.json'));
  if (files.length === 0) throw new Error(`Geen voorbeeldbestanden in ${kind}`);
  return files.sort().map((name) => {
    const schema = MODELS[name.split('.')[0] ?? ''];
    if (!schema) throw new Error(`Onbekend model in bestandsnaam: ${name}`);
    return { name, schema, data: JSON.parse(readFileSync(join(FIXTURES, kind, name), 'utf8')) };
  });
}

describe('agentcontract v1 (zod) tegen contracts/fixtures', () => {
  it.each(load('valid'))('accepteert $name', ({ schema, data }) => {
    const result = schema.safeParse(data);
    expect(result.error?.issues ?? []).toEqual([]);
    // Geen stille wijzigingen: wat zod teruggeeft, is wat er stond.
    expect(result.data).toEqual(data);
  });

  it.each(load('invalid'))('weigert $name', ({ schema, data }) => {
    expect(schema.safeParse(data).success).toBe(false);
  });
});

/**
 * Alle veldpaden van een JSON-schema (`a.b`, `a[].c`) — dezelfde functie als `field_paths` in
 * `contracts.py`. Zo valt ook een **optioneel** veld op dat maar aan één kant bestaat.
 */
function fieldPaths(schema: Record<string, unknown>): string[] {
  const defs = (schema.$defs ?? {}) as Record<string, unknown>;
  const paths = new Set<string>();
  // Verwijzingen die we nu aan het aflopen zijn: een recursieve vorm (zoals `z.json()`) mag geen
  // oneindige lus worden.
  const active = new Set<string>();
  const walk = (node: unknown, prefix: string): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const n = node as Record<string, unknown>;
    if (typeof n.$ref === 'string' && !active.has(n.$ref)) {
      active.add(n.$ref);
      walk(n.$ref === '#' ? schema : defs[n.$ref.split('/').pop() ?? ''], prefix);
      active.delete(n.$ref);
    }
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      const variants = n[key];
      if (Array.isArray(variants)) for (const variant of variants) walk(variant, prefix);
    }
    if (n.properties && typeof n.properties === 'object') {
      for (const [name, child] of Object.entries(n.properties as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${name}` : name;
        paths.add(path);
        walk(child, path);
      }
    }
    if (n.items !== undefined) walk(n.items, `${prefix}[]`);
    if (n.additionalProperties && typeof n.additionalProperties === 'object') {
      walk(n.additionalProperties, `${prefix}{}`);
    }
  };
  walk(schema, '');
  return [...paths].sort();
}

describe('agentcontract v1: dezelfde velden als pydantic', () => {
  const expected = JSON.parse(readFileSync(join(FIXTURES, '..', 'fields.json'), 'utf8')) as Record<
    string,
    string[]
  >;

  it.each(Object.entries(MODELS))(
    '%s heeft precies de velden uit contracts/fields.json',
    (name, schema) => {
      const actual = fieldPaths(z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>);
      expect(actual).toEqual(expected[name]);
    },
  );
});
