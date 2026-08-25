// @ts-check

/* global E, Far */

/**
 * Endo daemon plugin: a confined key/value service backed by the SQLite
 * capability named `sqlite-db`.
 *
 * @example
 * endo make src/confined-store.js -p @agent -n confined-store
 */

/** @import { ERef } from '@endo/eventual-send' */
/** @import { SqliteDb } from '@finquick/sqlite-plugin' */

/**
 * @param {{ lookup: (name: string) => unknown }} powers
 */
export const make = powers => {
  const dbP = /** @type {ERef<SqliteDb>} */ (E(powers).lookup('sqlite-db'));

  const createTableP = E(dbP).execute(`
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
    set(key, value) {
      return E.when(createTableP, () =>
        E(dbP).execute(
          `INSERT INTO confined_store (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [key, value],
        ),
      );
    },

    /**
     * @param {string} key
     */
    get(key) {
      return E.when(createTableP, () =>
        E.when(
          E(dbP).query('SELECT value FROM confined_store WHERE key = ?', [key]),
          rows => {
            if (rows.length === 0) {
              return undefined;
            }
            const value = rows[0].value;
            if (typeof value !== 'string') {
              throw Error('confined_store value is not text');
            }
            return value;
          },
        ),
      );
    },
  });
};
harden(make);
