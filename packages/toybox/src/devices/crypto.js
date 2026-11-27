/**
 * @file Crypto devices: signers over keys a vat can't read, out of which
 * a vat builds the signers a protocol wants (a JWT's, a chain's deploys),
 * with the hashes every vat has among its powers (../hashes.js). Bytes go
 * in and out as hex.
 *
 * As with the JWT signers (./jwt.js), a key is kept in someone's map
 * store: a signer holds the store's `readOnly()` facet and reads the key
 * at each signature, so the store's keeper rotates it under signers
 * already given out.
 *
 * - `Ed25519` signs a message. Its key is as ./jwt.js reads one: PKCS #8
 *   PEM, or base64 of the seed.
 * - `P-256` signs a message, hashing it with SHA-256, as JWS's ES256 does,
 *   and answers r ‖ s. Its key is PEM, SEC1 or PKCS #8.
 * - `secp256k1` signs a 32-byte digest, since each chain picks its own
 *   hash, and answers r ‖ s with low s. Its key is 64 hex digits.
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { Fail, q } from '@endo/errors';
import { M } from '@endo/patterns';
import { bytesOf } from '../hashes.js';
import { kzone } from '../kernel/objects.js';
import { parseKey as parseJwtKey } from './jwt.js';

/** @import { Device, Kref, TablePowers } from '../kernel/types.js' */

const { freeze, fromEntries } = Object;

export const TABLES = {
  // a signer: the key map it reads, the entry it reads, and its algorithm
  kcryptosigner:
    'CREATE TABLE IF NOT EXISTS kcryptosigner (id INTEGER PRIMARY KEY, keyMap TEXT NOT NULL, entry TEXT NOT NULL, algorithm TEXT NOT NULL)',
};

/** @typedef {'Ed25519' | 'P-256' | 'secp256k1'} Algorithm */
/** @typedef {{ kcryptosigner: { id: number, keyMap: Kref, entry: string, algorithm: Algorithm } }} Tables */

export const ALGORITHMS = freeze(
  /** @type {Algorithm[]} */ (['Ed25519', 'P-256', 'secp256k1']),
);

const Hex = M.string();

/**
 * A secp256k1 private key from a key map's text: 64 hex digits, perhaps
 * after `0x`. Error messages never quote the key.
 *
 * @param {string} text
 */
const secpKey = text => {
  const hex = text.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex))
    throw Error('not a key: a secp256k1 private key is 64 hex digits');
  return hexToBytes(hex);
};

/** WebCrypto's names for the algorithms it signs. */
const SUBTLE = freeze({
  Ed25519: { importAs: { name: 'Ed25519' }, signAs: { name: 'Ed25519' } },
  'P-256': {
    importAs: { name: 'ECDSA', namedCurve: 'P-256' },
    signAs: { name: 'ECDSA', hash: 'SHA-256' },
  },
});

/** Bytes of base64url `text`. @param {string} text */
const fromBase64url = text =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c =>
    c.charCodeAt(0),
  );

/**
 * The public key of `keyText`, and how to sign with it.
 *
 * @param {Pick<SubtleCrypto, 'importKey' | 'exportKey' | 'sign'>} subtle
 * @param {Algorithm} algorithm
 * @param {string} keyText
 * @returns {Promise<{ publicKey: Uint8Array, sign: (bytes: Uint8Array) => Promise<Uint8Array> }>}
 */
export const keyPair = async (subtle, algorithm, keyText) => {
  if (algorithm === 'secp256k1') {
    const key = secpKey(keyText);
    return {
      publicKey: secp256k1.getPublicKey(key, false),
      sign: async digest => {
        digest.length === 32 ||
          Fail`secp256k1 signs a 32-byte digest, not ${q(digest.length)} bytes`;
        return secp256k1.sign(digest, key, { lowS: true }).toCompactRawBytes();
      },
    };
  }
  const { alg, der } = parseJwtKey(keyText);
  const expected = algorithm === 'Ed25519' ? 'EdDSA' : 'ES256';
  alg === expected ||
    Fail`not a key: the key map's key isn't one for ${q(algorithm)}`;
  const { importAs, signAs } = SUBTLE[algorithm];
  const key = await subtle.importKey('pkcs8', der, importAs, true, ['sign']);
  const jwk = /** @type {JsonWebKey} exported as jwk */ (
    await subtle.exportKey('jwk', key)
  );
  const publicKey =
    algorithm === 'Ed25519'
      ? fromBase64url(String(jwk.x))
      : Uint8Array.from([
          4,
          ...fromBase64url(String(jwk.x)),
          ...fromBase64url(String(jwk.y)),
        ]);
  return {
    publicKey,
    sign: async bytes => new Uint8Array(await subtle.sign(signAs, key, bytes)),
  };
};

/**
 * The kernel's crypto devices. A `crypto` object's
 * `makeSigner(keyMap, algorithm, entry)` answers a signer whose
 * `sign(hex)` signs with the key in that entry of `keyMap`.
 *
 * @param {TablePowers<Tables>} powers
 * @param {object} io
 * @param {Pick<SubtleCrypto, 'importKey' | 'exportKey' | 'sign'>} io.subtle
 * @param {(kref: Kref, method: string, args: unknown[]) => Promise<unknown>} io.send deliver to a vat's object
 * @returns {Device}
 */
export const makeCryptoDevices = (
  { db, next, kernelObject, standIn, krefOf },
  { subtle, send },
) => {
  /** A signer's key as it is now. @param {string} rest a signer's id */
  const pairOf = async rest => {
    const { keyMap, entry, algorithm } = db
      .lookup('kcryptosigner', { id: Number(rest) })
      .one();
    const found =
      /** @type {[string, unknown][]} entries() of the key map, as it answered */ (
        await send(keyMap, 'entries', [])
      );
    const text = fromEntries(found)[entry];
    if (typeof text !== 'string')
      throw Error(`the key map has no ${entry} string`);
    return keyPair(subtle, algorithm, text);
  };

  return harden({
    kinds: {
      crypto: kzone.exoClass(
        'Crypto',
        M.interface('Crypto', {
          makeSigner: M.call(M.remotable(), M.or(...ALGORITHMS))
            .optional(M.string())
            .returns(M.remotable()),
        }),
        {
          /**
           * A signer that reads its key from `keyMap`'s `entry`.
           *
           * @param {object} keyMap anything with `entries()`, such as a map store's `readOnly()` facet
           * @param {Algorithm} algorithm
           * @param {string} [entry]
           */
          makeSigner(keyMap, algorithm, entry = 'privateKey') {
            const kref = krefOf(keyMap);
            if (!kref)
              throw Error('makeSigner takes a reference the kernel handed out');
            const id = next('cryptoSigner');
            db.insert('kcryptosigner', {
              id,
              keyMap: kref,
              entry,
              algorithm,
            });
            return standIn(kernelObject(`cryptoSigner:${id}`));
          },
        },
      ),
      cryptoSigner: kzone.exoClass(
        'Signer',
        M.interface('Signer', {
          getAlgorithm: M.call().returns(M.string()),
          getPublicKey: M.callWhen().returns(Hex),
          sign: M.callWhen(Hex).returns(Hex),
        }),
        {
          getAlgorithm() {
            return db
              .lookup('kcryptosigner', { id: Number(this.state.rest) })
              .one().algorithm;
          },
          /** The public key, in hex: uncompressed for the ECDSA curves. */
          async getPublicKey() {
            return bytesToHex((await pairOf(this.state.rest)).publicKey);
          },
          /**
           * A signature, in hex, of `hex`: a message, or for secp256k1 a
           * 32-byte digest.
           *
           * @param {string} hex
           */
          async sign(hex) {
            const bytes = bytesOf(hex, 'sign');
            const { sign } = await pairOf(this.state.rest);
            return bytesToHex(await sign(bytes));
          },
        },
      ),
    },
    /** A signer maker: whoever holds it can make signers from key maps it holds. */
    make: () => kernelObject(`crypto:${next('crypto')}`),
  });
};
