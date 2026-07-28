// @ts-check

/* global E, Far */

/**
 * Endo daemon plugin: a confined key/value service backed by the SQLite
 * capability named `sqlite-db`.
 *
 * @example
 * endo make src/confined-store.js -p @agent -n confined-store
 */

/**
 * @typedef {{
 *   execute: (
 *     sql: string,
 *     params?: (string | number | bigint | null | Uint8Array)[],
 *   ) => Promise<{ changes: number; lastInsertRowid: number | bigint }>,
 *   query: (
 *     sql: string,
 *     params?: (string | number | bigint | null | Uint8Array)[],
 *   ) => Promise<Record<string, unknown>[]>,
 * }} SqliteDb
 */

/**
 * @param {{ lookup: (name: string) => unknown }} powers
 */
export const make = async powers => {
  const db = /** @type {SqliteDb} */ (
    await E(powers).lookup('sqlite-db')
  );

  await E(db).execute(`
    CREATE TABLE IF NOT EXISTS confined_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  return Far('ConfinedStore', {
    /**
     * @param {string} key
     * @param {string} value
     */
    async set(key, value) {
      await E(db).execute(
        `INSERT INTO confined_store (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value],
      );
    },

    /**
     * @param {string} key
     */
    async get(key) {
      const rows = await E(db).query(
        'SELECT value FROM confined_store WHERE key = ?',
        [key],
      );
      if (rows.length === 0) {
        return undefined;
      }
      const value = rows[0].value;
      if (typeof value !== 'string') {
        throw Error('confined_store value is not text');
      }
      return value;
    },
  });
};
harden(make);
