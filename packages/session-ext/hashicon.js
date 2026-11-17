/**
 * @file A hashicon: a picture of a key's hash, so two pages can show
 * they hold the same key without showing it. The app's owner page and
 * this extension each draw one from SHA-256 of a proposal's key.
 *
 * diigo-cache embeds this function's source in its owner page, from a
 * copy its tests hold identical to this file: change both.
 */

/**
 * As much of an SVG element as a hashicon uses: declared here, not taken
 * from the DOM's types, since diigo-cache's vats typecheck without them.
 *
 * @typedef {{ setAttribute(name: string, value: string): void, append(...nodes: unknown[]): void }} SvgNode
 */

/**
 * A robot's face: people tell faces apart, and remember them, better
 * than patterns. The digest picks the head's shape and hue, the eyes and
 * which way they look, the mouth, the antennas, the ears, and the
 * background's hue: about 21 bits. Self-contained, so a page can embed
 * its source.
 *
 * @template {SvgNode} N
 * @param {{ createElementNS(ns: string, name: string): N }} doc a document
 * @param {Uint8Array} bytes a digest, 9 bytes at least
 * @returns {N}
 */
export const hashicon = (doc, bytes) => {
  const ns = 'http://www.w3.org/2000/svg';
  /** @param {string} name @param {Record<string, string | number>} attrs */
  const el = (name, attrs) => {
    const e = doc.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  /** @param {number} i @param {number} n */
  const pick = (i, n) => bytes[i] % n;
  /** @param {number} i @param {number} light */
  const color = (i, light) =>
    'hsl(' + (bytes[i] % 12) * 30 + ' 60% ' + light + '%)';
  const skin = color(0, 55);
  const dark = color(0, 22);
  const glow = color(4, 72);
  const svg = el('svg', {
    viewBox: '0 0 32 32',
    width: 40,
    height: 40,
    role: 'img',
    'aria-label': 'a robot face drawn from the key',
  });
  /** @param {string} name @param {Record<string, string | number>} attrs */
  const add = (name, attrs) => svg.append(el(name, attrs));
  add('rect', { width: 32, height: 32, fill: color(1, 90) });
  const antennas = [[], [16], [10, 22]][pick(6, 3)];
  for (const x of antennas) {
    add('line', {
      x1: x,
      y1: 9,
      x2: x,
      y2: 4,
      stroke: dark,
      'stroke-width': 1.5,
    });
    add('circle', { cx: x, cy: 3.5, r: 2, fill: glow, stroke: dark });
  }
  if (pick(7, 2))
    for (const x of [3, 27])
      add('rect', { x, y: 14, width: 2, height: 7, fill: dark });
  const head = pick(2, 3);
  if (head === 2)
    add('ellipse', {
      cx: 16,
      cy: 18,
      rx: 11.5,
      ry: 10,
      fill: skin,
      stroke: dark,
    });
  else
    add('rect', {
      x: 5,
      y: 8,
      width: 22,
      height: 20,
      rx: head ? 6 : 1.5,
      fill: skin,
      stroke: dark,
    });
  const look = pick(8, 3) - 1;
  const eyes = pick(3, 4);
  /** @type {number[]} */
  let pupils = [11, 21];
  if (eyes === 0)
    for (const cx of [11, 21])
      add('circle', { cx, cy: 15, r: 3.2, fill: glow, stroke: dark });
  else if (eyes === 1)
    for (const x of [8, 18])
      add('rect', { x, y: 12, width: 6, height: 6, fill: glow, stroke: dark });
  else if (eyes === 2) {
    add('rect', {
      x: 7,
      y: 12.5,
      width: 18,
      height: 5,
      rx: 2.5,
      fill: glow,
      stroke: dark,
    });
    pupils = [12, 20];
  } else {
    add('circle', { cx: 16, cy: 15, r: 4.5, fill: glow, stroke: dark });
    pupils = [16];
  }
  for (const cx of pupils)
    add('circle', { cx: cx + look * 1.2, cy: 15, r: 1.3, fill: dark });
  const mouth = pick(5, 4);
  if (mouth === 0) {
    add('rect', { x: 10, y: 21, width: 12, height: 4, fill: dark });
    for (const x of [13, 16, 19])
      add('line', { x1: x, y1: 21, x2: x, y2: 25, stroke: skin });
  } else if (mouth === 1)
    add('path', {
      d: 'M10 21 Q16 27 22 21',
      fill: 'none',
      stroke: dark,
      'stroke-width': 2,
    });
  else if (mouth === 2)
    add('line', {
      x1: 10,
      y1: 23,
      x2: 22,
      y2: 23,
      stroke: dark,
      'stroke-width': 2,
    });
  else add('ellipse', { cx: 16, cy: 23, rx: 3, ry: 2.5, fill: dark });
  return svg;
};

/**
 * The hashicon of a proposal's key: SHA-256 of its text, drawn.
 *
 * @template {SvgNode} N
 * @param {{ createElementNS(ns: string, name: string): N }} doc a document
 * @param {Pick<SubtleCrypto, 'digest'>} subtle
 * @param {string} key
 */
export const keyIcon = async (doc, subtle, key) =>
  hashicon(
    doc,
    new Uint8Array(
      await subtle.digest('SHA-256', new TextEncoder().encode(key)),
    ),
  );
