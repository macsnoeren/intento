import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * Afbeeldingscontrole voor alles wat de Vocabulary binnenkomt (INTENTO-NEW-DESIGN §20, §53).
 *
 * Eén module voor elke afbeelding: de SVG's uit de startset (§15.1) én later eigen uploads en
 * imports (PNG, JPEG, WebP). Wat niet door de controle komt, wordt niet opgeslagen. De controle kijkt
 * naar de **werkelijke inhoud**, nooit naar een extensie of een opgegeven content-type.
 *
 * SVG-regels: geldige XML met een `<svg>`-root en een geldige `viewBox`; geen DOCTYPE of entiteiten;
 * geen `<script>`, `<foreignObject>` of andere elementen die code of externe inhoud binnenhalen; geen
 * `on…`-attributen; `href`/`src` alleen naar een fragment (`#id`); geen externe `url(…)` of `@import` in
 * stijlen; geen `javascript:` ergens in een attribuut.
 */

export type CheckedMimeType = 'image/svg+xml' | 'image/png' | 'image/jpeg' | 'image/webp';

export type ImageCheckResult =
  | { ok: true; mimeType: CheckedMimeType; extension: 'svg' | 'png' | 'jpg' | 'webp' }
  | { ok: false; reason: string };

export interface ImageCheckOptions {
  /** Maximale grootte in bytes. */
  maxBytes: number;
  /** Mag het een SVG zijn? Alleen bij de gecontroleerde import van de startset (V8). */
  allowSvg: boolean;
}

/** Elementen die code uitvoeren, externe inhoud binnenhalen of attributen dynamisch kunnen zetten. */
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'embed',
  'object',
  'audio',
  'video',
  'canvas',
  'handler',
  'listener',
  'set',
  'animate',
  'animatemotion',
  'animatetransform',
  'animatecolor',
  'image',
  'feimage',
]);

function reject(reason: string): ImageCheckResult {
  return { ok: false, reason };
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Herkent PNG, JPEG en WebP aan de magic bytes. */
function rasterType(bytes: Uint8Array): ImageCheckResult | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: true, mimeType: 'image/png', extension: 'png' };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { ok: true, mimeType: 'image/jpeg', extension: 'jpg' };
  }
  // "RIFF" <grootte> "WEBP"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { ok: true, mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}

function localName(name: string): string {
  const index = name.indexOf(':');
  return (index >= 0 ? name.slice(index + 1) : name).toLowerCase();
}

const VIEWBOX =
  /^\s*-?[\d.]+(?:e-?\d+)?[\s,]+-?[\d.]+(?:e-?\d+)?[\s,]+[\d.]+(?:e-?\d+)?[\s,]+[\d.]+(?:e-?\d+)?\s*$/i;

/** Externe resources in CSS: een `url(…)` die niet naar een fragment wijst, of `@import`. */
function hasExternalCss(css: string): boolean {
  if (/@import/i.test(css)) return true;
  const urls = css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi);
  for (const match of urls) {
    if (!(match[2] ?? '').trim().startsWith('#')) return true;
  }
  return false;
}

type Node = Record<string, unknown>;

/** Loopt de geparste boom af (preserveOrder-vorm) en geeft de eerste overtreding terug. */
function inspectNodes(nodes: unknown, depth: number): string | null {
  if (!Array.isArray(nodes)) return null;
  if (depth > 64) return 'te diep geneste SVG';
  for (const node of nodes as Node[]) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || key === '#text') continue;
      if (key.startsWith('?')) continue; // processing instruction (<?xml …?>), geen element
      const name = localName(key);
      if (FORBIDDEN_ELEMENTS.has(name)) return `verboden element <${key}>`;
      const attributes = (node[':@'] ?? {}) as Record<string, unknown>;
      for (const [rawAttr, rawValue] of Object.entries(attributes)) {
        const attr = localName(rawAttr.replace(/^@_/, ''));
        const attrValue = String(rawValue);
        if (attr.startsWith('on')) return `event-handler-attribuut ${attr}`;
        if (/javascript:/i.test(attrValue.replace(/\s+/g, ''))) return `javascript: in ${attr}`;
        if ((attr === 'href' || attr === 'src') && !attrValue.trim().startsWith('#')) {
          return `externe verwijzing in ${attr}`;
        }
        if (attr === 'style' && hasExternalCss(attrValue)) return 'externe resource in style';
        if (/url\(/i.test(attrValue) && hasExternalCss(attrValue)) {
          return `externe resource in ${attr}`;
        }
      }
      if (name === 'style') {
        const css = JSON.stringify(value);
        if (hasExternalCss(css)) return 'externe resource in <style>';
      }
      const problem = inspectNodes(value, depth + 1);
      if (problem) return problem;
    }
  }
  return null;
}

function checkSvg(text: string): ImageCheckResult {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return reject('DOCTYPE of entiteiten zijn niet toegestaan');
  const valid = XMLValidator.validate(text);
  if (valid !== true) return reject('geen geldige XML');

  const parser = new XMLParser({
    ignoreAttributes: false,
    preserveOrder: true,
    processEntities: false,
    allowBooleanAttributes: true,
    parseTagValue: false,
    parseAttributeValue: false,
  });
  const tree = parser.parse(text) as Node[];
  const roots = tree.filter((node) =>
    Object.keys(node).some((key) => !key.startsWith('?') && key !== ':@' && key !== '#text'),
  );
  if (roots.length !== 1) return reject('precies één root-element verwacht');
  const root = roots[0]!;
  const rootName = Object.keys(root).find((key) => key !== ':@')!;
  if (localName(rootName) !== 'svg') return reject('root-element is geen <svg>');
  const rootAttrs = (root[':@'] ?? {}) as Record<string, unknown>;
  const viewBox = rootAttrs['@_viewBox'] ?? rootAttrs['@_viewbox'];
  if (typeof viewBox !== 'string' || !VIEWBOX.test(viewBox)) return reject('geen geldige viewBox');

  const problem = inspectNodes(tree, 0);
  return problem ? reject(problem) : { ok: true, mimeType: 'image/svg+xml', extension: 'svg' };
}

/** Controleert een afbeelding; geeft het werkelijke type terug, of de reden van weigeren. */
export function checkImage(bytes: Uint8Array, options: ImageCheckOptions): ImageCheckResult {
  if (bytes.length === 0) return reject('leeg bestand');
  if (bytes.length > options.maxBytes) {
    return reject(`te groot (${bytes.length} bytes, maximaal ${options.maxBytes})`);
  }
  const raster = rasterType(bytes);
  if (raster) return raster;

  if (!options.allowSvg) return reject('alleen PNG, JPEG of WebP toegestaan');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return reject('geen geldige UTF-8-tekst');
  }
  if (!/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) {
    return reject('onbekend afbeeldingsformaat');
  }
  return checkSvg(text);
}
