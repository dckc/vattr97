// @ts-check
import harden from '@endo/harden';

/**
 * @typedef {object} Row what is kept at rest for one capability
 * @property {string} id derived from the secret; not the secret
 * @property {string} kind
 * @property {string | null} parent id of the capability this one was
 *   delegated from
 * @property {Uint8Array<ArrayBuffer>} sealed the payload, readable only with the secret
 * @property {Uint8Array<ArrayBuffer> | null} note readable only with the parent's secret
 * @property {number} createdAt
 * @property {number | null} expiresAt
 * @property {number | null} revokedAt
 */

/**
 * @typedef {object} RowStore
 * @property {(id: string) => Row | undefined} get
 * @property {(row: Row) => void} insert
 * @property {(id: string, sealed: Uint8Array<ArrayBuffer>) => void} setSealed
 * @property {(id: string, revokedAt: number) => void} setRevoked
 * @property {(parent: string) => Row[]} childrenOf
 */

/**
 * @typedef {object} Holder proof of having presented a capability's secret
 * @property {string} id
 * @property {CryptoKey} wrapKey
 */

/**
 * The table of capabilities. A secret is never stored: its row is found by a
 * derived id and its payload opened by a derived key, so the rows alone
 * grant nothing.
 *
 * @param {object} powers
 * @param {RowStore} powers.store
 * @param {import('./secrets.js').SecretTools} powers.secrets
 * @param {() => number} powers.now milliseconds
 */
export const makeRefTable = ({ store, secrets, now }) => {
  /** @type {Map<string, Promise<unknown>>} */
  const updating = new Map();

  /**
   * Throws unless `id` and every capability it was delegated from are
   * present, unexpired and unrevoked.
   *
   * @param {string} id
   */
  const assertLive = id => {
    /** @type {string | null} */
    let at = id;
    while (at !== null) {
      const row = store.get(at);
      if (!row) {
        throw Error('no such capability');
      }
      if (row.revokedAt !== null) {
        throw Error('capability revoked');
      }
      if (row.expiresAt !== null && row.expiresAt <= now()) {
        throw Error('capability expired');
      }
      at = row.parent;
    }
  };

  /**
   * @param {object} spec
   * @param {string} spec.kind
   * @param {unknown} spec.payload JSON-serializable
   * @param {Holder} [spec.parent] the capability being attenuated
   * @param {unknown} [spec.note] for the parent, about this delegation
   * @param {number | null} [spec.expiresAt]
   * @returns {Promise<{ secret: string, id: string, expiresAt: number | null }>}
   */
  const mint = async ({
    kind,
    payload,
    parent = undefined,
    note = undefined,
    expiresAt = null,
  }) => {
    const parentRow = parent ? store.get(parent.id) : undefined;
    const limits = [expiresAt, parentRow ? parentRow.expiresAt : null].filter(
      limit => limit !== null,
    );
    const effective = limits.length > 0 ? Math.min(...limits) : null;

    const secret = secrets.mintSecret(kind);
    const { id, wrapKey } = await secrets.derive(secret);
    store.insert(
      harden({
        id,
        kind,
        parent: parent ? parent.id : null,
        sealed: await secrets.seal(wrapKey, payload),
        note: parent ? await secrets.seal(parent.wrapKey, note ?? null) : null,
        createdAt: now(),
        expiresAt: effective,
        revokedAt: null,
      }),
    );
    return harden({ secret, id, expiresAt: effective });
  };

  /**
   * @param {string} secret
   * @returns {Promise<Holder & { kind: string }>}
   */
  const open = async secret => {
    const { id, wrapKey } = await secrets.derive(secret);
    assertLive(id);
    const row = /** @type {Row} */ (store.get(id));
    return harden({ id, wrapKey, kind: row.kind });
  };

  /**
   * @param {Holder} holder
   * @returns {Promise<any>} the payload
   */
  const read = async ({ id, wrapKey }) => {
    assertLive(id);
    const row = /** @type {Row} */ (store.get(id));
    return secrets.unseal(wrapKey, row.sealed);
  };

  /**
   * Replace a payload with `change(payload)`. Updates to one capability run
   * one at a time, in order.
   *
   * @param {Holder} holder
   * @param {(payload: any) => unknown} change
   * @returns {Promise<void>}
   */
  const update = (holder, change) => {
    const { id, wrapKey } = holder;
    const run = async () => {
      const next = change(await read(holder));
      store.setSealed(id, await secrets.seal(wrapKey, next));
    };
    const turn = (updating.get(id) ?? Promise.resolve()).then(run, run);
    const settled = turn.catch(() => {});
    updating.set(id, settled);
    settled.then(() => {
      if (updating.get(id) === settled) {
        updating.delete(id);
      }
    });
    return turn;
  };

  /**
   * @param {Holder} parent
   */
  const children = async parent => {
    assertLive(parent.id);
    const rows = store.childrenOf(parent.id);
    return harden(
      await Promise.all(
        rows.map(async row => ({
          id: row.id,
          kind: row.kind,
          note: row.note
            ? await secrets.unseal(parent.wrapKey, row.note)
            : null,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          revoked: row.revokedAt !== null,
        })),
      ),
    );
  };

  /**
   * Revoke a capability delegated directly from `parent`, and with it
   * everything delegated from that capability in turn.
   *
   * @param {Holder} parent
   * @param {string} childId
   */
  const revokeChild = (parent, childId) => {
    assertLive(parent.id);
    const row = store.get(childId);
    if (!row || row.parent !== parent.id) {
      throw Error('not a delegation of this capability');
    }
    if (row.revokedAt === null) {
      store.setRevoked(childId, now());
    }
  };

  return harden({
    assertLive,
    mint,
    open,
    read,
    update,
    children,
    revokeChild,
  });
};
harden(makeRefTable);

/** @typedef {ReturnType<typeof makeRefTable>} RefTable */
