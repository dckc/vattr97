/**
 * @file JWT signers: a vat holds a handle that signs short-lived JWTs with
 * a key it can't read. The key is kept in someone's map store, as a
 * WebApp's session cookie is (see examples/store-maker.js): the signer
 * holds the store's `readOnly()` facet and reads the key at each
 * signature, so the store's keeper rotates it under handles already given
 * out. A vat has no clock, randomness, or signing of its own; the signer
 * stamps each JWT with the time and a fresh nonce.
 *
 * A signer's `kid`, its fixed claims, and its lifetime are set when it's
 * made; `sign(claims)` adds claims of its own, such as the request a JWT
 * is for, but can't change a fixed one.
 */
import { encodeBase64 } from '@endo/base64';
import { Fail, q } from '@endo/errors';
import { M } from '@endo/patterns';
import { kzone } from '../kernel/objects.js';

/** @import { Device, Kref, TablePowers } from '../kernel/types.js' */

const { freeze, fromEntries, hasOwn, keys } = Object;

export const TABLES = {
  // a signer: the key map it reads, its kid, its fixed claims (JSON), and its lifetime
  kjwtsigner:
    'CREATE TABLE IF NOT EXISTS kjwtsigner (id INTEGER PRIMARY KEY, keyMap TEXT NOT NULL, kid TEXT NOT NULL, claims TEXT NOT NULL, ttl INTEGER NOT NULL)',
};

/** @typedef {{ kjwtsigner: { id: number, keyMap: Kref, kid: string, claims: string, ttl: number } }} Tables */

/** The entry of a key map that holds the private key. */
export const KEY_ENTRY = 'privateKey';

/** Claims the signer stamps itself, which no one else may set. */
const STAMPED = freeze(['nbf', 'exp', 'iat']);

/** The longest a JWT may live, in seconds. */
const MAX_TTL = 300;

/** @param {Uint8Array} bytes */
export const base64url = bytes =>
  encodeBase64(bytes)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

/** Bytes of base64 `text`. @param {string} text */
const decodeBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

/** @param {string} text */
const utf8url = text => base64url(new TextEncoder().encode(text));

/** A DER length. @param {number} n */
const derLength = n =>
  n < 0x80
    ? [n]
    : n < 0x100
      ? [0x81, n]
      : n < 0x10000
        ? [0x82, n >> 8, n & 0xff]
        : Fail`DER: ${q(n)} bytes is too long`;

/** A DER element. @param {number} tag @param {ArrayLike<number>} body */
const der = (tag, body) =>
  Uint8Array.from([tag, ...derLength(body.length), ...Array.from(body)]);

/** @param {...Uint8Array} parts */
const concat = (...parts) => Uint8Array.from(parts.flatMap(p => Array.from(p)));

// AlgorithmIdentifiers: id-ecPublicKey on prime256v1, and id-Ed25519
const EC_P256 = Uint8Array.from([
  0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08,
  0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
]);
const ED25519 = Uint8Array.from([0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70]);
const VERSION_0 = Uint8Array.from([0x02, 0x01, 0x00]);

/** Whether `bytes` starts with `prefix`. @param {Uint8Array} bytes @param {Uint8Array} prefix */
const startsWith = (bytes, prefix) => prefix.every((b, i) => bytes[i] === b);

/** PKCS #8 of a private key. @param {Uint8Array} algorithm @param {Uint8Array} privateKey */
const pkcs8 = (algorithm, privateKey) =>
  der(0x30, concat(VERSION_0, algorithm, der(0x04, privateKey)));

/** The base64 body of PEM `label`, if `text` is one. @param {string} text @param {string} label */
const pemBody = (text, label) => {
  const m = text.match(
    new RegExp(`-----BEGIN ${label}-----([^-]*)-----END ${label}-----`),
  );
  return m ? decodeBase64(m[1].replace(/\s+/g, '')) : undefined;
};

/**
 * What a key map's text is: an ES256 key as PEM, SEC1 (`EC PRIVATE KEY`)
 * or PKCS #8 (`PRIVATE KEY`), or an Ed25519 key as PKCS #8 PEM, or as
 * base64 of its 32-byte seed, or of the seed then the public key, as
 * Coinbase hands one out. A `\n` written out as two
 * characters, as a key pasted from JSON may be, counts as a newline.
 * Error messages never quote the key.
 *
 * @param {string} text
 * @returns {{ alg: 'ES256' | 'EdDSA', der: Uint8Array }}
 */
export const parseKey = text => {
  const pem = text.replaceAll('\\n', '\n');
  const sec1 = pemBody(pem, 'EC PRIVATE KEY');
  if (sec1) return { alg: 'ES256', der: pkcs8(EC_P256, sec1) };
  const p8 = pemBody(pem, 'PRIVATE KEY');
  if (p8)
    return {
      alg: startsWith(p8.subarray(5), ED25519) ? 'EdDSA' : 'ES256',
      der: p8,
    };
  if (/^[A-Za-z0-9+/=\s]+$/.test(text)) {
    const raw = decodeBase64(text.replace(/\s+/g, ''));
    if (raw.length === 32 || raw.length === 64)
      return {
        alg: 'EdDSA',
        der: pkcs8(ED25519, der(0x04, raw.subarray(0, 32))),
      };
  }
  throw Error(
    'not a key: neither PEM (EC PRIVATE KEY, PRIVATE KEY) nor base64 of an Ed25519 seed',
  );
};

/** WebCrypto's name for each JWS alg. */
const ALGORITHMS = freeze({
  ES256: {
    importAs: { name: 'ECDSA', namedCurve: 'P-256' },
    signAs: { name: 'ECDSA', hash: 'SHA-256' },
  },
  EdDSA: { importAs: { name: 'Ed25519' }, signAs: { name: 'Ed25519' } },
});

/**
 * A JWT of `header` and `claims`, signed with `keyText`.
 *
 * @param {Pick<SubtleCrypto, 'importKey' | 'sign'>} subtle
 * @param {string} keyText
 * @param {Record<string, unknown>} header without `alg`, which the key says
 * @param {Record<string, unknown>} claims
 */
export const signJwt = async (subtle, keyText, header, claims) => {
  const { alg, der: keyDer } = parseKey(keyText);
  const { importAs, signAs } = ALGORITHMS[alg];
  const key = await subtle.importKey('pkcs8', keyDer, importAs, false, [
    'sign',
  ]);
  const input = `${utf8url(JSON.stringify({ alg, ...header }))}.${utf8url(JSON.stringify(claims))}`;
  const signature = await subtle.sign(
    signAs,
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
};

const Claims = M.recordOf(M.string(), M.or(M.string(), M.arrayOf(M.string())));

/**
 * The kernel's JWT signers. `jwtSigners` is the maker:
 * `make(keyMap, kid, claims, ttl)` answers a signer, whose
 * `sign(claims)` answers a JWT whose header has `kid`, `typ`, and a fresh
 * `nonce`, and whose claims are the fixed ones, the ones given, `nbf` (now,
 * in seconds), and `exp` (`ttl` seconds later).
 *
 * @param {TablePowers<Tables>} powers
 * @param {object} io
 * @param {() => number} io.now the time, in milliseconds since the epoch
 * @param {(n: number) => Uint8Array} io.random `n` random bytes
 * @param {Pick<SubtleCrypto, 'importKey' | 'sign'>} io.subtle
 * @param {(kref: Kref, method: string, args: unknown[]) => Promise<unknown>} io.send deliver to a vat's object
 * @returns {Device}
 */
export const makeJwtSigners = (
  { db, next, kernelObject, standIn, krefOf },
  { now, random, subtle, send },
) =>
  harden({
    kinds: {
      jwtSigners: kzone.exoClass(
        'JwtSigners',
        M.interface('JwtSigners', {
          make: M.call(M.remotable(), M.string(), Claims)
            .optional(M.number())
            .returns(M.remotable()),
        }),
        {
          /**
           * A signer that reads its key from `keyMap`'s `privateKey` entry.
           *
           * @param {object} keyMap anything with `entries()`, such as a map store's `readOnly()` facet
           * @param {string} kid the key's name, in each JWT's header
           * @param {Record<string, string | string[]>} claims in every JWT it signs
           * @param {number} [ttl] seconds each JWT lives
           */
          make(keyMap, kid, claims, ttl = 120) {
            const kref = krefOf(keyMap);
            if (!kref)
              throw Error('make takes a reference the kernel handed out');
            (Number.isSafeInteger(ttl) && ttl > 0 && ttl <= MAX_TTL) ||
              Fail`ttl: ${q(ttl)} is not whole seconds, 1 to ${q(MAX_TTL)}`;
            const stamped = keys(claims).filter(c => STAMPED.includes(c));
            if (stamped.length)
              throw Error(`the signer stamps ${stamped.join(', ')} itself`);
            const id = next('jwtSigner');
            db.insert('kjwtsigner', {
              id,
              keyMap: kref,
              kid,
              claims: JSON.stringify(claims),
              ttl,
            });
            return standIn(kernelObject(`jwtSigner:${id}`));
          },
        },
      ),
      jwtSigner: kzone.exoClass(
        'JwtSigner',
        M.interface('JwtSigner', {
          sign: M.callWhen(Claims).returns(M.string()),
        }),
        {
          /**
           * A JWT of the fixed claims and these, which may not contradict
           * them, stamped now.
           *
           * @param {Record<string, string | string[]>} more
           */
          async sign(more) {
            const row = db
              .lookup('kjwtsigner', { id: Number(this.state.rest) })
              .one();
            /** @type {Record<string, unknown>} */
            const fixed = JSON.parse(row.claims);
            const clash = keys(more).filter(
              c => STAMPED.includes(c) || hasOwn(fixed, c),
            );
            if (clash.length)
              throw Error(`sign: ${clash.join(', ')} is not yours to set`);
            const found =
              /** @type {[string, unknown][]} entries() of the key map, as it answered */ (
                await send(row.keyMap, 'entries', [])
              );
            const keyText = fromEntries(found)[KEY_ENTRY];
            if (typeof keyText !== 'string')
              throw Error(`the key map has no ${KEY_ENTRY} string`);
            const nbf = Math.floor(now() / 1000);
            const nonce = Array.from(random(16), b =>
              b.toString(16).padStart(2, '0'),
            ).join('');
            return signJwt(
              subtle,
              keyText,
              { kid: row.kid, nonce, typ: 'JWT' },
              { ...fixed, ...more, nbf, exp: nbf + row.ttl },
            );
          },
        },
      ),
    },
    /** A JWT signer maker: whoever holds it can make signers from key maps it holds. */
    make: () => kernelObject(`jwtSigners:${next('jwtSigners')}`),
  });
