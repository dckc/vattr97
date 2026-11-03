/** @file A kernel vat's runtime, in its facet: SES, liveslots, and the vat's own module (`vat.js`). */
import '@endo/init';
import { DurableObject } from 'cloudflare:workers';
import { E, Far } from '@endo/far';
import { M } from '@endo/patterns';
import { makeLiveslots } from './liveslots.js';

/**
 * @import { CapData, Send, SqlDatabase, SqlValue, Vatstore } from './types.js';
 * @import { Syscall } from './kernel.js';
 */

/**
 * Make the clock and randomness inert for the vat's code, which runs in
 * this, the facet's start compartment: SES tames them only in new
 * Compartments, so take those: `Date.now()`, `new Date()`, and
 * `Math.random()` throw. Likewise `performance.now()` throws, and
 * `crypto` keeps only `subtle.digest`.
 */
const makeAmbientInert = () => {
  const { Date: InertDate, Math: InertMath } = new Compartment().globalThis;
  const { subtle } = crypto;
  const inert = {
    Date: InertDate,
    Math: InertMath,
    crypto: harden({
      subtle: harden({
        /** @type {SubtleCrypto['digest']} */
        digest: (algorithm, data) => subtle.digest(algorithm, data),
      }),
    }),
    performance: harden({
      now: () => {
        throw Error('secure mode performance.now() throws');
      },
    }),
  };
  for (const [name, value] of Object.entries(inert))
    Object.defineProperty(globalThis, name, {
      value,
      writable: false,
      configurable: false,
    });
};
makeAmbientInert();

/**
 * What the kernel gives a vat's facet: its syscall, and nothing else.
 *
 * @typedef {{ syscall: Service<Syscall> }} VatEnv
 */

/**
 * The vatstore: the facet's own SQLite, which neither the kernel nor any
 * other vat can read.
 *
 * @param {SqlStorage} sql
 * @returns {Vatstore}
 */
const makeVatstore = sql => {
  sql.exec(
    'CREATE TABLE IF NOT EXISTS vatstore (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  );
  return harden({
    /** @param {string} k */
    get: k =>
      /** @type {string | undefined} TEXT */ (
        sql.exec('SELECT v FROM vatstore WHERE k = ?', k).toArray()[0]?.v
      ),
    /** @param {string} k @param {string} v */
    put: (k, v) =>
      void sql.exec('INSERT OR REPLACE INTO vatstore VALUES (?, ?)', k, v),
    /** @param {string} k */
    delete: k => void sql.exec('DELETE FROM vatstore WHERE k = ?', k),
    /** @param {string} prefix */
    keys: prefix =>
      sql
        .exec(
          'SELECT k FROM vatstore WHERE k >= ? AND k < ? ORDER BY k',
          prefix,
          `${prefix}￿`,
        )
        .toArray()
        .map(r => /** @type {string} TEXT */ (r.k)),
  });
};

/**
 * The vat's own SQLite, as ertp-books' `SqlDatabase` takes it: `exec(sql)`,
 * and `prepare(sql)` for `run`, `get`, and `all` with parameters. The same
 * database holds the vatstore, in the `vatstore` table: the vat may break
 * its own durable objects, and no one else's.
 *
 * Statements run when called, not in a transaction: whatever a vat does
 * between awaits commits together, as in any Durable Object. For more,
 * `transaction(fn)` runs `fn` in one, which rolls back if it throws; `fn`
 * can't await.
 *
 * @param {DurableObjectStorage} storage
 * @returns {SqlDatabase}
 */
const makeSqlDatabase = storage => {
  const { sql } = storage;
  return harden({
    transaction: fn => storage.transactionSync(fn),
    /** @param {string} text */
    exec: text => void sql.exec(text),
    /** @param {string} text */
    prepare: text =>
      harden({
        /** @param {SqlValue[]} params */
        run: (...params) => {
          sql.exec(text, ...params).toArray();
          // rowsWritten would count index rows too; changes() is what better-sqlite3 means
          const { n } = sql.exec('SELECT changes() AS n').one();
          return { changes: /** @type {number} INTEGER */ (n) };
        },
        // rows are as the vat's own query shapes them; its prepare() names the type
        /** @param {SqlValue[]} params */
        get: (...params) =>
          /** @type {any} */ (sql.exec(text, ...params).toArray()[0]),
        /** @param {SqlValue[]} params */
        all: (...params) =>
          /** @type {any[]} */ (sql.exec(text, ...params).toArray()),
      }),
  });
};

/**
 * A kernel vat: bundled by build.js and loaded as a facet of the Kernel,
 * beside the vat's own code. Its only way out is `env.syscall`, which names
 * objects by this vat's vrefs; the kernel holds the c-list that gives them
 * meaning.
 */
/** @extends {DurableObject<VatEnv>} */
export class App extends DurableObject {
  #ready;

  /** @param {DurableObjectState} ctx @param {VatEnv} env */
  constructor(ctx, env) {
    super(ctx, env);
    this.#ready = this.#boot();
  }

  /** Each incarnation: build the root again; durable objects come back from the vatstore as they're used. */
  async #boot() {
    // Syscall's RPC stub, as its methods' plain types: tsc's own
    // instantiation of the stub type recurses too deep
    const syscall =
      /** @type {{ send: Send, params: () => Promise<CapData> }} */ (
        /** @type {unknown} */ (this.env.syscall)
      );
    const ls = makeLiveslots({
      send: (vref, method, capdata) => syscall.send(vref, method, capdata),
      kv: makeVatstore(this.ctx.storage.sql),
    });
    const { zone } = ls;
    if (!zone) throw Error('a vat with a vatstore has a zone');
    const params = ls.unserialize(await syscall.params());
    // imported here, not at the top: a static import of an external module
    // evaluates before this bundle's body, so before lockdown and the taming above
    const vat = await import('./vat.js');
    ls.setRoot(
      vat.buildRootObject(
        harden({
          E,
          Far,
          M,
          zone,
          db: makeSqlDatabase(this.ctx.storage),
        }),
        params,
      ),
    );
    // what building the root sent (an ingress's serve, say) is done before the vat counts as ready
    await ls.quiescent();
    return ls;
  }

  /** Resolves once this incarnation has its root; rejects if building it failed. */
  async ready() {
    await this.#ready;
  }

  /** @param {string} vref @param {string} method @param {CapData} capdata */
  async deliver(vref, method, capdata) {
    return (await this.#ready).deliver(vref, method, capdata);
  }
}
