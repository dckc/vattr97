import harden from '@endo/harden';
import { makeGate } from '../src/caps.js';
import { makeCidTools } from '../src/cid.js';
import { makeCipher } from '../src/cipher.js';
import { makeFileStore } from '../src/files.js';
import { makeRefTable } from '../src/refTable.js';
import { makeSecretTools } from '../src/secrets.js';

export const subtle = crypto.subtle;
export const getRandomValues = bytes => crypto.getRandomValues(bytes);
export const sha256 = async bytes =>
  new Uint8Array(await subtle.digest('SHA-256', bytes));
export const { rawCidOf } = makeCidTools({ sha256 });

export const utf8 = text => new TextEncoder().encode(text);
export const text = bytes => new TextDecoder().decode(bytes);

/** Whether `needle` occurs anywhere in `haystack` (both byte arrays). */
export const includesBytes = (haystack, needle) => {
  for (let at = 0; at + needle.length <= haystack.length; at += 1) {
    if (needle.every((byte, i) => haystack[at + i] === byte)) {
      return true;
    }
  }
  return false;
};

/** Content-addressed blocks in a Map, exposed for inspection as `stored`. */
export const makeMemoryBlocks = () => {
  const stored = new Map();
  return harden({
    stored,
    put: async bytes => {
      const cid = await rawCidOf(bytes);
      stored.set(cid, bytes.slice());
      return cid;
    },
    get: async cid => {
      const bytes = stored.get(cid);
      if (!bytes || (await rawCidOf(bytes)) !== cid) {
        throw Error(`block does not match ${cid}`);
      }
      return bytes;
    },
  });
};

/** Capability rows in a Map, exposed for inspection as `rows`. */
export const makeMemoryRowStore = () => {
  const rows = new Map();
  return harden({
    rows,
    get: id => rows.get(id),
    insert: row => {
      rows.set(row.id, row);
    },
    setSealed: (id, sealed) => {
      rows.set(id, { ...rows.get(id), sealed });
    },
    setRevoked: (id, revokedAt) => {
      rows.set(id, { ...rows.get(id), revokedAt });
    },
    childrenOf: parent =>
      [...rows.values()].filter(row => row.parent === parent),
  });
};

/** A clock the test advances by hand. */
export const makeManualClock = (start = 1_000_000) => {
  let at = start;
  return harden({
    now: () => at,
    advance: ms => {
      at += ms;
    },
  });
};

/** The whole service over in-memory blocks and rows. */
export const makeTestService = ({ chunkBytes = 16 } = {}) => {
  const clock = makeManualClock();
  const blocks = makeMemoryBlocks();
  const store = makeMemoryRowStore();
  const cipher = makeCipher({ subtle, getRandomValues });
  const files = makeFileStore({ blocks, cipher, chunkBytes });
  const secrets = makeSecretTools({ subtle, getRandomValues });
  const refTable = makeRefTable({ store, secrets, now: clock.now });
  const gate = makeGate({ refTable, files, now: clock.now });
  return harden({ gate, clock, blocks, store, refTable, secrets });
};
