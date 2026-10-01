// @ts-check
import harden from '@endo/harden';

export const MAX_PUT_BYTES = 16 * 1024 * 1024;
export const MAX_READ_BYTES = 4 * 1024 * 1024;

/**
 * @typedef {object} Entry one file in a vault
 * @property {string} name
 * @property {string} type media type
 * @property {string} cid
 * @property {string} key
 * @property {number} size
 * @property {number} addedAt
 */

/**
 * @param {unknown} name
 * @returns {string}
 */
const checkName = name => {
  if (
    typeof name !== 'string' ||
    name.length < 1 ||
    name.length > 255 ||
    /[\u0000-\u001f/\\]/.test(name)
  ) {
    throw TypeError('bad file name');
  }
  return name;
};

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {number}
 */
const checkCount = (value, max) => {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > max
  ) {
    throw RangeError(`expected an integer from 0 to ${max}`);
  }
  return Number(value);
};

/**
 * @param {unknown} options
 * @param {() => number} now
 * @returns {number | null} when a delegation made now should expire
 */
const expiryFrom = (options, now) => {
  const { ttlMs = undefined } = /** @type {{ ttlMs?: unknown }} */ (
    options ?? {}
  );
  if (ttlMs === undefined || ttlMs === null) {
    return null;
  }
  if (typeof ttlMs !== 'number' || !(ttlMs > 0) || !Number.isFinite(ttlMs)) {
    throw RangeError('ttlMs must be a positive number');
  }
  return now() + ttlMs;
};

/**
 * The capabilities of the service. Each is a hardened record of closures;
 * holding one is the authority to call it.
 *
 * @param {object} powers
 * @param {import('./refTable.js').RefTable} powers.refTable
 * @param {import('./files.js').FileStore} powers.files
 * @param {() => number} powers.now milliseconds
 */
export const makeGate = ({ refTable, files, now }) => {
  /**
   * Read access to one file, on the authority of `holder`.
   *
   * @param {import('./refTable.js').Holder} holder
   * @param {Entry} entry
   */
  const makeFile = (holder, entry) => {
    const { name, type, cid, key, size } = entry;
    /** @type {ReturnType<typeof files.open> | undefined} */
    let opened;

    const shares = async () => {
      const delegations = await refTable.children(holder);
      return harden(
        delegations
          .filter(({ kind, note }) => kind === 'file' && note?.name === name)
          .map(({ id, createdAt, expiresAt, revoked }) => ({
            shareId: id,
            createdAt,
            expiresAt,
            revoked,
          })),
      );
    };

    return harden({
      stat: async () => {
        refTable.assertLive(holder.id);
        return harden({ name, type, size });
      },

      /**
       * @param {number} offset
       * @param {number} length
       * @returns {Promise<Uint8Array<ArrayBuffer>>}
       */
      read: async (offset, length) => {
        refTable.assertLive(holder.id);
        checkCount(offset, Number.MAX_SAFE_INTEGER);
        checkCount(length, MAX_READ_BYTES);
        opened = opened ?? files.open({ cid, key });
        const reader = await opened;
        return reader.read(offset, length);
      },

      /**
       * Delegate read access to this file as a new web-key secret. The
       * secret is returned once and cannot be recovered.
       *
       * @param {{ ttlMs?: number }} [options]
       */
      share: async (options = {}) => {
        refTable.assertLive(holder.id);
        const { secret, id, expiresAt } = await refTable.mint({
          kind: 'file',
          payload: { name, type, cid, key, size },
          parent: holder,
          note: { name },
          expiresAt: expiryFrom(options, now),
        });
        return harden({ webkey: secret, shareId: id, expiresAt });
      },

      shares,

      /** @param {string} shareId as returned by `share` or `shares` */
      revoke: async shareId => {
        const mine = await shares();
        if (!mine.some(share => share.shareId === shareId)) {
          throw Error('not a share of this file');
        }
        refTable.revokeChild(holder, shareId);
      },
    });
  };

  /**
   * Read and write access to a set of named files.
   *
   * @param {import('./refTable.js').Holder} holder
   */
  const makeVault = holder => {
    /** @returns {Promise<Entry[]>} */
    const entries = async () => (await refTable.read(holder)).files;

    /** @param {string} name */
    const get = async name => {
      const entry = (await entries()).find(e => e.name === name);
      if (!entry) {
        throw Error(`no file named ${JSON.stringify(name)}`);
      }
      return makeFile(holder, entry);
    };

    return harden({
      list: async () =>
        harden(
          (await entries()).map(({ name, type, size, addedAt }) => ({
            name,
            type,
            size,
            addedAt,
          })),
        ),

      /**
       * Store `bytes` under `name`, replacing any file of that name.
       *
       * @param {string} name
       * @param {Uint8Array<ArrayBuffer>} bytes
       * @param {string} [type]
       */
      put: async (name, bytes, type = 'application/octet-stream') => {
        refTable.assertLive(holder.id);
        checkName(name);
        if (!(bytes instanceof Uint8Array) || bytes.length > MAX_PUT_BYTES) {
          throw TypeError(`expected at most ${MAX_PUT_BYTES} bytes`);
        }
        if (typeof type !== 'string' || type.length > 255) {
          throw TypeError('bad media type');
        }
        const ref = await files.write(bytes);
        /** @type {Entry} */
        const entry = { name, type, ...ref, addedAt: now() };
        await refTable.update(holder, payload => ({
          ...payload,
          files: [
            ...payload.files.filter(
              (/** @type {Entry} */ e) => e.name !== name,
            ),
            entry,
          ],
        }));
        return harden({ name, type, size: ref.size });
      },

      get,

      /**
       * Drop `name` from the vault and revoke every share of it.
       *
       * @param {string} name
       */
      remove: async name => {
        const file = await get(name);
        for (const { shareId, revoked } of await file.shares()) {
          if (!revoked) {
            await file.revoke(shareId);
          }
        }
        await refTable.update(holder, payload => ({
          ...payload,
          files: payload.files.filter(
            (/** @type {Entry} */ e) => e.name !== name,
          ),
        }));
      },
    });
  };

  return harden({
    /**
     * Make an empty vault. Its web-key secret is returned once and cannot
     * be recovered.
     */
    createVault: async () => {
      const { secret } = await refTable.mint({
        kind: 'vault',
        payload: { files: [] },
      });
      return harden({ webkey: secret });
    },

    /**
     * Exchange a web-key secret for the capability it designates.
     *
     * @param {string} secret
     */
    open: async secret => {
      const { id, wrapKey, kind } = await refTable.open(secret);
      const holder = harden({ id, wrapKey });
      switch (kind) {
        case 'vault':
          return harden({ kind, vault: makeVault(holder) });
        case 'file':
          return harden({
            kind,
            file: makeFile(holder, await refTable.read(holder)),
          });
        default:
          throw Error('no such capability');
      }
    },
  });
};
harden(makeGate);

/** @typedef {ReturnType<typeof makeGate>} Gate */
