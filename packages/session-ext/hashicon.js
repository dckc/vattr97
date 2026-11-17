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
 * A 5×5 grid, mirrored left to right, in one hue: the hue from the first
 * byte, the cells from the next two. Self-contained, so a page can embed
 * its source.
 *
 * @template {SvgNode} N
 * @param {{ createElementNS(ns: string, name: string): N }} doc a document
 * @param {Uint8Array} bytes a digest, 3 bytes at least
 * @returns {N}
 */
export const hashicon = (doc, bytes) => {
  const ns = 'http://www.w3.org/2000/svg';
  const el = (
    /** @type {string} */ name,
    /** @type {Record<string, string | number>} */ attrs,
  ) => {
    const e = doc.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  const svg = el('svg', {
    viewBox: '-1 -1 7 7',
    width: 40,
    height: 40,
    role: 'img',
    'aria-label': 'hashicon of the key',
  });
  svg.append(
    el('rect', { x: -1, y: -1, width: 7, height: 7, fill: '#f4f4f4' }),
  );
  const fill = 'hsl(' + Math.round((bytes[0] * 360) / 256) + ' 65% 40%)';
  for (let i = 0; i < 15; i += 1) {
    if (((bytes[1 + (i >> 3)] >> (i & 7)) & 1) === 0) continue;
    const row = i % 5;
    const col = Math.floor(i / 5);
    for (const x of new Set([col, 4 - col]))
      svg.append(el('rect', { x, y: row, width: 1, height: 1, fill }));
  }
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
