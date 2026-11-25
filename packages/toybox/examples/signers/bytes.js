/**
 * @file Bytes as hex, as the crypto device takes and answers them, and the
 * encodings signers built on it need: UTF-8, base64url, base58, varints,
 * and DER signatures. Pure, with no imports, so a definition carries it
 * beside its main module.
 */

/** Throws `message`. @param {string} message @returns {never} */
export const fail = message => {
  throw Error(message);
};

/** Hex of `bytes`. @param {ArrayLike<number>} bytes */
export const hexOf = bytes =>
  Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

/** Bytes of `hex`. @param {string} hex */
export const bytesOf = hex => {
  /^([0-9a-fA-F]{2})*$/.test(hex) || fail(`not hex: ${hex}`);
  return Uint8Array.from(hex.match(/../g) ?? [], h => parseInt(h, 16));
};

/** Hex of `text`, in UTF-8. @param {string} text */
export const utf8Hex = text =>
  encodeURIComponent(text).replace(/%([0-9A-F]{2})|[^]/g, (c, h) =>
    h ? h.toLowerCase() : c.charCodeAt(0).toString(16).padStart(2, '0'),
  );

const B64URL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url of the bytes of `hex`, without padding, as JWS has it. @param {string} hex */
export const base64urlOfHex = hex => {
  const bytes = bytesOf(hex);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j += 1) out += B64URL[(n >> (18 - 6 * j)) & 63];
  }
  return out;
};

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** base58 of the bytes of `hex`, as Bitcoin has it: a leading zero byte is a `1`. @param {string} hex */
export const base58OfHex = hex => {
  const zeros = (hex.match(/^(00)*/)?.[0].length ?? 0) / 2;
  let n = hex ? BigInt(`0x${hex}`) : 0n;
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return '1'.repeat(zeros) + out;
};

/** A protobuf varint, in hex. @param {number | bigint} n */
export const varintHex = n => {
  let v = BigInt(n);
  let out = '';
  do {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    out += (v ? byte | 0x80 : byte).toString(16).padStart(2, '0');
  } while (v);
  return out;
};

/** DER of an r ‖ s signature, 32 bytes each, in hex. @param {string} compact */
export const derOfCompact = compact => {
  compact.length === 128 || fail('r ‖ s is 64 bytes');
  /** @param {string} x */
  const int = x => {
    const trimmed = x.replace(/^(00)+(?=..)/, '');
    const body =
      parseInt(trimmed.slice(0, 2), 16) >= 0x80 ? `00${trimmed}` : trimmed;
    return `02${(body.length / 2).toString(16).padStart(2, '0')}${body}`;
  };
  const seq = int(compact.slice(0, 64)) + int(compact.slice(64));
  return `30${(seq.length / 2).toString(16).padStart(2, '0')}${seq}`;
};
