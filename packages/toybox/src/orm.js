/** @file Rows as records: single-table statements over a Durable Object's SQLite, limited to some of its tables. */

const { keys, values } = Object;

/** The columns of a table, by name. @typedef {Record<string, SqlStorageValue | Uint8Array>} Row */

/**
 * @param {Record<string, unknown>} fields
 * @param {string} sep
 */
const clause = (fields, sep) =>
  keys(fields)
    .map(name => `${name} = ?`)
    .join(sep);

/**
 * Statements on `tables`, and no others. Table and column names go into the
 * SQL as they are, so they must be the caller's own literals; only values
 * are bound.
 *
 * @template {Record<string, Row>} DB the tables, by name
 * @param {Pick<SqlStorage, 'exec'>} sql
 * @param {string[]} tables
 */
export const makeORM = (sql, tables) => {
  /** @param {string} table */
  const own = table => {
    if (!tables.includes(table)) throw Error(`${table} is not a table here`);
    return table;
  };

  /**
   * @param {string} table
   * @param {Record<string, unknown>} keyFields
   * @returns {Pick<SqlStorageCursor<any>, 'toArray' | 'one'>} rows as the table's type says: the schema is what keeps that true
   */
  const select = (table, keyFields) =>
    sql.exec(
      `SELECT * FROM ${own(table)} WHERE ${clause(keyFields, ' AND ') || '1=1'}`,
      .../** @type {SqlStorageValue[]} */ (values(keyFields)),
    );

  /**
   * @param {string} verb
   * @param {string} table
   * @param {Row} row
   */
  const insertRow = (verb, table, row) => {
    const names = keys(row);
    sql.exec(
      `${verb} INTO ${own(table)} (${names.join(', ')}) VALUES (${names
        .map(() => '?')
        .join(', ')})`,
      .../** @type {SqlStorageValue[]} */ (values(row)),
    );
  };

  return harden({
    /**
     * The rows that match `keyFields`; every row, without them.
     *
     * @template {string & keyof DB} T
     * @param {T} table
     * @param {Partial<DB[T]>} [keyFields]
     * @returns {DB[T][]}
     */
    query: (table, keyFields = {}) => select(table, keyFields).toArray(),
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
        /** @param {Partial<DB[T]>} dataFields */
        update: dataFields => {
          sql.exec(
            `UPDATE ${own(table)} SET ${clause(dataFields, ', ')} WHERE ${clause(keyFields, ' AND ')}`,
            .../** @type {SqlStorageValue[]} */ ([
              ...values(dataFields),
              ...values(keyFields),
            ]),
          );
        },
        delete: () => {
          sql.exec(
            `DELETE FROM ${own(table)} WHERE ${clause(keyFields, ' AND ')}`,
            .../** @type {SqlStorageValue[]} */ (values(keyFields)),
          );
        },
      }),
    /**
     * @template {string & keyof DB} T
     * @param {T} table
     * @param {DB[T]} row
     */
    insert: (table, row) => insertRow('INSERT', table, row),
    /**
     * Keep `row`, unless the table has one with its key: for rows that a key
     * determines, such as content by hash.
     *
     * @template {string & keyof DB} T
     * @param {T} table
     * @param {DB[T]} row
     */
    insertOrIgnore: (table, row) => insertRow('INSERT OR IGNORE', table, row),
  });
};

/**
 * @template {Record<string, Row>} DB
 * @typedef {ReturnType<typeof makeORM<DB>>} ORM
 */
