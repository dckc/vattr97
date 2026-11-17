/** @file What the ORM uses of a Durable Object's SqlStorage, over node:sqlite, for tests. */

/** @import { DatabaseSync } from 'node:sqlite' */

/**
 * What the ORM uses of a Durable Object's SqlStorage, over `db`.
 *
 * @param {DatabaseSync} db
 */
export const makeSql = db =>
  /** @type {Pick<SqlStorage, 'exec'>} what the ORM uses of it */ (
    /** @type {unknown} */ ({
      /** @param {string} text @param {(string | number | null)[]} bindings as SqlStorage's exec takes them */
      exec: (text, ...bindings) => {
        const statement = db.prepare(text);
        const rows = text.startsWith('SELECT')
          ? statement.all(...bindings).map(row => ({ ...row }))
          : (statement.run(...bindings), []);
        return {
          toArray: () => rows,
          one: () => {
            if (rows.length !== 1) throw Error('Expected exactly one result');
            return rows[0];
          },
        };
      },
    })
  );
