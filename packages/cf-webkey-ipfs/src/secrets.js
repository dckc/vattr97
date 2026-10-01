// @ts-check
import harden from '@endo/harden';
import { decodeBase32, encodeBase32 } from './base32.js';

/** A web-key secret: `<kind>:<26 base32 chars>`, 128 bits of entropy. */
const SECRET = /^([a-z][a-z0-9-]*):([a-z2-7]{26})$/;

const SALT = new TextEncoder().encode('cf-webkey-ipfs/v1');
const ID_INFO = new TextEncoder().encode('row id');
const WRAP_INFO = new TextEncoder().encode('wrap key');

const NONCE_BYTES = 12;

/**
 * @param {unknown} value
 * @returns {{ kind: string, entropy: Uint8Array<ArrayBuffer> }}
 */
export const parseSecret = value => {
  const match = typeof value === 'string' ? SECRET.exec(value) : null;
  if (!match) {
    throw TypeError('malformed web-key secret');
  }
  return harden({ kind: match[1], entropy: decodeBase32(match[2]) });
};
harden(parseSecret);

/**
 * @typedef {object} Derived
 * @property {string} id names the secret's row; reveals nothing usable
 * @property {CryptoKey} wrapKey opens what was sealed for the secret
 */

/**
 * @param {object} powers
 * @param {SubtleCrypto} powers.subtle
 * @param {(bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>} powers.getRandomValues
 */
export const makeSecretTools = ({ subtle, getRandomValues }) => {
  /**
   * @param {string} kind
   * @returns {string} a fresh secret; the only copy
   */
  const mintSecret = kind =>
    `${kind}:${encodeBase32(getRandomValues(new Uint8Array(16)))}`;

  /**
   * Two independent values from one secret: neither the id nor anything
   * sealed under the wrap key lets a reader recover the secret.
   *
   * @param {string} secret
   * @returns {Promise<Derived>}
   */
  const derive = async secret => {
    const { entropy } = parseSecret(secret);
    const base = await subtle.importKey('raw', entropy, 'HKDF', false, [
      'deriveBits',
      'deriveKey',
    ]);
    const hkdf = { name: 'HKDF', hash: 'SHA-256', salt: SALT };
    const idBits = await subtle.deriveBits(
      { ...hkdf, info: ID_INFO },
      base,
      256,
    );
    const wrapKey = await subtle.deriveKey(
      { ...hkdf, info: WRAP_INFO },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    return harden({ id: encodeBase32(new Uint8Array(idBits)), wrapKey });
  };

  /**
   * @param {CryptoKey} wrapKey
   * @param {unknown} value JSON-serializable
   * @returns {Promise<Uint8Array<ArrayBuffer>>} nonce followed by ciphertext
   */
  const seal = async (wrapKey, value) => {
    const nonce = getRandomValues(new Uint8Array(NONCE_BYTES));
    const plain = new TextEncoder().encode(JSON.stringify(value));
    const cipher = await subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      wrapKey,
      plain,
    );
    const out = new Uint8Array(NONCE_BYTES + cipher.byteLength);
    out.set(nonce, 0);
    out.set(new Uint8Array(cipher), NONCE_BYTES);
    return out;
  };

  /**
   * @param {CryptoKey} wrapKey
   * @param {Uint8Array<ArrayBuffer>} sealed as produced by `seal`
   * @returns {Promise<any>}
   */
  const unseal = async (wrapKey, sealed) => {
    const plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.subarray(0, NONCE_BYTES) },
      wrapKey,
      sealed.subarray(NONCE_BYTES),
    );
    return harden(JSON.parse(new TextDecoder().decode(plain)));
  };

  return harden({ mintSecret, derive, seal, unseal });
};
harden(makeSecretTools);

/** @typedef {ReturnType<typeof makeSecretTools>} SecretTools */
