/** @file Rows as records: single-table statements over a Durable Object's SQLite, so callers needn't write SQL for them. */

const { keys, values } = Object;

/** The columns of a table, by name. @typedef {Record<string, SqlStorageValue | Uint8Array>} Row */

/**
 * Table and column names go into the SQL as they are, so they must be the
 * caller's own literals; only values are bound.
 *
 * @template {Record<string, Row>} DB the tables, by name
 * @param {SqlStorage} sql
 */
export const makeORM = sql => {
  /**
   * @param {string} table
   * @param {Partial<Row>} keyFields
   * @returns {SqlStorageCursor<any>} rows as the table's type says: the schema is what keeps that true
   */
  const select = (table, keyFields) =>
    sql.exec(
      `SELECT * FROM ${table} WHERE ${keys(keyFields)
        .map(name => `${name} = ?`)
        .join(' AND ')}`,
      ...values(keyFields),
    );

  return harden({
    /**
     * The rows that match `keyFields`.
     *
     * @template {string & keyof DB} T
     * @param {T} table
     * @param {Partial<DB[T]>} keyFields
     * @returns {DB[T][]}
     */
    query: (table, keyFields) => select(table, keyFields).toArray(),
    /**
     * The row `keyFields` picks out: `get()` answers it if it's there, and
     * `one()` throws if it isn't.
     *
     * @template {string & keyof DB} T
     * @param {T} table
     * @param {Partial<DB[T]>} keyFields
     */
    lookup: (table, keyFields) =>
      harden({
        /** @returns {DB[T] | undefined} */
        get: () => select(table, keyFields).toArray()[0],
        /** @returns {DB[T]} */
        one: () => select(table, keyFields).one(),
      }),
    /**
     * Keep `row`, unless the table has one with its key: for rows that a key
     * determines, such as content by hash.
     *
     * @template {string & keyof DB} T
     * @param {T} table
     * @param {DB[T]} row
     */
    insertOrIgnore: (table, row) => {
      const names = keys(row);
      sql.exec(
        `INSERT OR IGNORE INTO ${table} (${names.join(', ')}) VALUES (${names
          .map(() => '?')
          .join(', ')})`,
        ...values(row),
      );
    },
  });
};
