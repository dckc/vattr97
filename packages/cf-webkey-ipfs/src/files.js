// @ts-check
import harden from '@endo/harden';
import { isRawCid } from './cid.js';

export const CHUNK_BYTES = 256 * 1024;

/**
 * @typedef {object} FileRef all that is needed to read one stored file
 * @property {string} cid the encrypted manifest block
 * @property {string} key the content key
 * @property {number} size plaintext bytes
 */

/**
 * @typedef {object} Manifest
 * @property {1} v
 * @property {number} size
 * @property {number} chunkBytes
 * @property {string[]} chunks CIDs of the encrypted chunks, in order
 */

/**
 * @param {unknown} value
 * @returns {Manifest}
 */
const parseManifest = value => {
  const m = /** @type {Manifest} */ (value);
  if (
    typeof m !== 'object' ||
    m === null ||
    m.v !== 1 ||
    !Number.isSafeInteger(m.size) ||
    m.size < 0 ||
    !Number.isSafeInteger(m.chunkBytes) ||
    m.chunkBytes < 1 ||
    !Array.isArray(m.chunks) ||
    !m.chunks.every(isRawCid) ||
    m.chunks.length !== Math.ceil(m.size / m.chunkBytes)
  ) {
    throw Error('malformed manifest');
  }
  return m;
};

/**
 * Files as encrypted chunks: each chunk is one block, and an encrypted
 * manifest block lists them. Only ciphertext reaches `blocks`.
 *
 * @param {object} powers
 * @param {import('./ipfsBlocks.js').Blocks} powers.blocks
 * @param {import('./cipher.js').Cipher} powers.cipher
 * @param {number} [powers.chunkBytes]
 */
export const makeFileStore = ({ blocks, cipher, chunkBytes = CHUNK_BYTES }) => {
  /**
   * @param {Uint8Array<ArrayBuffer>} bytes
   * @returns {Promise<FileRef>}
   */
  const write = async bytes => {
    const key = cipher.newContentKey();
    const box = await cipher.forKey(key);
    /** @type {string[]} */
    const chunks = [];
    for (let at = 0; at < bytes.length; at += chunkBytes) {
      const plain = bytes.subarray(at, at + chunkBytes);
      const sealed = await box.encryptChunk(chunks.length, plain);
      chunks.push(await blocks.put(sealed));
    }
    /** @type {Manifest} */
    const manifest = { v: 1, size: bytes.length, chunkBytes, chunks };
    const cid = await blocks.put(
      await box.encryptManifest(
        /** @type {Uint8Array<ArrayBuffer>} */ (
          new TextEncoder().encode(JSON.stringify(manifest))
        ),
      ),
    );
    return harden({ cid, key, size: bytes.length });
  };

  /**
   * @param {Pick<FileRef, 'cid' | 'key'>} ref
   */
  const open = async ({ cid, key }) => {
    const box = await cipher.forKey(key);
    const manifest = parseManifest(
      JSON.parse(
        new TextDecoder().decode(
          await box.decryptManifest(await blocks.get(cid)),
        ),
      ),
    );

    /**
     * @param {number} offset
     * @param {number} length
     * @returns {Promise<Uint8Array<ArrayBuffer>>} shorter than `length` at end of file
     */
    const read = async (offset, length) => {
      const end = Math.min(offset + length, manifest.size);
      const out = new Uint8Array(Math.max(end - offset, 0));
      const first = Math.floor(offset / manifest.chunkBytes);
      const last = Math.ceil(end / manifest.chunkBytes);
      for (let index = first; index < last; index += 1) {
        const plain = await box.decryptChunk(
          index,
          await blocks.get(manifest.chunks[index]),
        );
        const chunkStart = index * manifest.chunkBytes;
        const from = Math.max(offset, chunkStart);
        const to = Math.min(end, chunkStart + plain.length);
        out.set(
          plain.subarray(from - chunkStart, to - chunkStart),
          from - offset,
        );
      }
      return out;
    };

    return harden({ size: manifest.size, read });
  };

  return harden({ write, open });
};
harden(makeFileStore);

/** @typedef {ReturnType<typeof makeFileStore>} FileStore */
