// @ts-check
import harden from '@endo/harden';
import { decodeBase32, encodeBase32 } from './base32.js';

/** Nonce domains: a content key never reuses a nonce across block roles. */
const DATA = 0;
const MANIFEST = 1;

/**
 * @param {number} domain
 * @param {number} index
 * @returns {Uint8Array<ArrayBuffer>} a 12 byte AES-GCM nonce
 */
const nonceFor = (domain, index) => {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  view.setUint8(0, domain);
  view.setBigUint64(4, BigInt(index));
  return nonce;
};

/**
 * @param {object} powers
 * @param {SubtleCrypto} powers.subtle
 * @param {(bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>} powers.getRandomValues
 */
export const makeCipher = ({ subtle, getRandomValues }) => {
  /** @returns {string} a fresh content key, used for exactly one file */
  const newContentKey = () => encodeBase32(getRandomValues(new Uint8Array(32)));

  /**
   * @param {string} contentKey
   */
  const forKey = async contentKey => {
    const key = await subtle.importKey(
      'raw',
      decodeBase32(contentKey),
      'AES-GCM',
      false,
      ['encrypt', 'decrypt'],
    );

    /**
     * @param {number} domain
     * @param {number} index
     * @param {Uint8Array<ArrayBuffer>} plain
     */
    const encrypt = async (domain, index, plain) =>
      new Uint8Array(
        await subtle.encrypt(
          { name: 'AES-GCM', iv: nonceFor(domain, index) },
          key,
          plain,
        ),
      );

    /**
     * @param {number} domain
     * @param {number} index
     * @param {Uint8Array<ArrayBuffer>} cipher
     */
    const decrypt = async (domain, index, cipher) =>
      new Uint8Array(
        await subtle.decrypt(
          { name: 'AES-GCM', iv: nonceFor(domain, index) },
          key,
          cipher,
        ),
      );

    return harden({
      /** @param {number} index @param {Uint8Array<ArrayBuffer>} plain */
      encryptChunk: (index, plain) => encrypt(DATA, index, plain),
      /** @param {number} index @param {Uint8Array<ArrayBuffer>} cipher */
      decryptChunk: (index, cipher) => decrypt(DATA, index, cipher),
      /** @param {Uint8Array<ArrayBuffer>} plain */
      encryptManifest: plain => encrypt(MANIFEST, 0, plain),
      /** @param {Uint8Array<ArrayBuffer>} cipher */
      decryptManifest: cipher => decrypt(MANIFEST, 0, cipher),
    });
  };

  return harden({ newContentKey, forKey });
};
harden(makeCipher);

/** @typedef {ReturnType<typeof makeCipher>} Cipher */
