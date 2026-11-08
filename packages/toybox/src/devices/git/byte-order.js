/** @file The order git sorts names in: by their UTF-8 bytes. */

const encoder = new TextEncoder();

/**
 * Compare `a` and `b` by their UTF-8 bytes, as C's `memcmp` would. That's
 * code point order; JavaScript's `<` and default `sort()` compare UTF-16
 * code units instead, which differ for a name with a character past U+FFFF
 * beside one in U+E000 to U+FFFF.
 *
 * @param {string} a
 * @param {string} b
 */
export const compareUtf8 = (a, b) => {
  const [x, y] = [encoder.encode(a), encoder.encode(b)];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
