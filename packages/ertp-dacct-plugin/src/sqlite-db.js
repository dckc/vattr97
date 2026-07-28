// @ts-check

/**
 * Endo daemon plugin: unconfined SQLite access.
 *
 * The database path is injected when the plugin is made. It is deliberately
 * not accepted by any method on the returned capability, so clients cannot
 * use this object to open other files.
 *
 * @example
 * endo make --UNCONFINED src/sqlite-db.js \
 *   -n sqlite-db -E DB_PATH=/tmp/vattr97.sqlite
 */

import { makeExo } from '@endo/exo';
import { M } from '@endo/patterns';
import Database from 'better-sqlite3';

const SqliteDbI = M.interface('SqliteDb', {
  execute: M.call(M.string()).optional(M.array()).returns(M.record()),
  query: M.call(M.string()).optional(M.array()).returns(M.array()),
  close: M.call().returns(M.undefined()),
});

/**
 * @typedef {string | number | bigint | null | Uint8Array} SqlValue
 */

/**
 * Open the configured database and return its attenuated remote interface.
 *
 * This function runs in an unconfined Endo worker because loading
 * `better-sqlite3` and opening a file both require ambient Node.js authority.
 *
 * @param {unknown} [_powers]
 * @param {unknown} [_context]
 * @param {{ env?: Record<string, string> }} [options]
 */
export const make = (
  _powers = undefined,
  _context = undefined,
  options = {},
) => {
  const path = options.env?.DB_PATH;
  if (path === undefined || path === '') {
    throw Error('DB_PATH must be set in the environment');
  }

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return makeExo('SqliteDb', SqliteDbI, {
    /**
     * @param {string} sql
     * @param {SqlValue[]} [params]
     */
    execute(sql, params = []) {
      const { changes, lastInsertRowid } = db.prepare(sql).run(...params);
      return harden({ changes, lastInsertRowid });
    },

    /**
     * @param {string} sql
     * @param {SqlValue[]} [params]
     */
    query(sql, params = []) {
      const rows = /** @type {Record<string, unknown>[]} */ (
        db.prepare(sql).all(...params)
      );
      return harden(rows.map(row => ({ ...row })));
    },

    close() {
      db.close();
    },
  });
};
harden(make);
