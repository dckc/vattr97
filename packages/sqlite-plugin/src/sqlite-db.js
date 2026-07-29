// @ts-check

/**
 * Endo daemon plugin for attenuated SQLite access.
 *
 * The database path is injected when the unconfined plugin is made. Clients
 * can use autocommit operations through the root capability or reserve the
 * connection by calling begin(), which returns the sole capability permitted
 * to use the connection until commit() or rollback().
 */

import { makeExo } from '@endo/exo';
import harden from '@endo/harden';
import { M } from '@endo/patterns';
import Database from 'better-sqlite3';

const SqliteResultShape = M.recordOf(M.string(), M.scalar());

const SqliteStatementI = M.interface('SqliteStatement', {
  run: M.call().rest(M.any()).returns(SqliteResultShape),
  get: M.call().rest(M.any()).returns(M.or(M.record(), M.undefined())),
  all: M.call().rest(M.any()).returns(M.array()),
});

const SqliteTransactionI = M.interface('SqliteTransaction', {
  execute: M.call(M.string()).optional(M.array()).returns(SqliteResultShape),
  query: M.call(M.string()).optional(M.array()).returns(M.array()),
  prepare: M.call(M.string()).returns(M.remotable('SqliteStatement')),
  commit: M.call().returns(M.undefined()),
  rollback: M.call().returns(M.undefined()),
});

const SqliteDbI = M.interface('SqliteDb', {
  execute: M.call(M.string()).optional(M.array()).returns(SqliteResultShape),
  query: M.call(M.string()).optional(M.array()).returns(M.array()),
  prepare: M.call(M.string()).returns(M.remotable('SqliteStatement')),
  begin: M.call().returns(M.remotable('SqliteTransaction')),
  close: M.call().returns(M.undefined()),
});

/**
 * @typedef {string | number | bigint | null | Uint8Array} SqlValue
 */

/**
 * @typedef {{
 *   changes: number,
 *   lastInsertRowid: number | bigint,
 * }} SqliteResult
 */

/**
 * @template {SqlValue[]} [TParams=SqlValue[]]
 * @template [TRow=Record<string, unknown>]
 * @typedef {{
 *   run: (...params: TParams) => SqliteResult,
 *   get: (...params: TParams) => TRow | undefined,
 *   all: (...params: TParams) => TRow[],
 * }} SqliteStatement
 */

/**
 * @typedef {{
 *   execute: (sql: string, params?: SqlValue[]) => SqliteResult,
 *   query: (
 *     sql: string,
 *     params?: SqlValue[],
 *   ) => Record<string, unknown>[],
 *   prepare: <
 *     TParams extends SqlValue[] = SqlValue[],
 *     TRow = Record<string, unknown>,
 *   >(sql: string) => SqliteStatement<TParams, TRow>,
 *   commit: () => void,
 *   rollback: () => void,
 * }} SqliteTransaction
 */

/**
 * @typedef {{
 *   execute: (sql: string, params?: SqlValue[]) => SqliteResult,
 *   query: (
 *     sql: string,
 *     params?: SqlValue[],
 *   ) => Record<string, unknown>[],
 *   prepare: <
 *     TParams extends SqlValue[] = SqlValue[],
 *     TRow = Record<string, unknown>,
 *   >(sql: string) => SqliteStatement<TParams, TRow>,
 *   begin: () => SqliteTransaction,
 *   close: () => void,
 * }} SqliteDb
 */

/**
 * @typedef {{
 *   active: boolean,
 *   failed: boolean,
 *   failure?: unknown,
 * }} TransactionToken
 */

const transactionControlKeywords = harden(
  new Set(['BEGIN', 'COMMIT', 'END', 'RELEASE', 'ROLLBACK', 'SAVEPOINT']),
);

/**
 * Return the first SQL keyword after whitespace and leading comments.
 *
 * @param {string} sql
 */
const firstKeyword = sql => {
  const statement = sql.replace(
    /^(?:(?:\s+)|(?:--[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/))*/u,
    '',
  );
  return /^[A-Za-z]+/u.exec(statement)?.[0].toUpperCase();
};

/**
 * Require callers to use begin(), commit(), and rollback() rather than
 * bypassing transaction ownership with raw SQL.
 *
 * @param {string} sql
 */
const assertDataStatement = sql => {
  const keyword = firstKeyword(sql);
  if (keyword !== undefined && transactionControlKeywords.has(keyword)) {
    throw Error(
      'Transaction control SQL is not allowed; use begin(), commit(), or rollback()',
    );
  }
};

/**
 * Open the configured database and return its attenuated remote interface.
 *
 * @param {unknown} [_powers]
 * @param {unknown} [_context]
 * @param {{ env?: Record<string, string> }} [options]
 * @returns {SqliteDb}
 */
export const make = (
  _powers = undefined,
  _context = undefined,
  options = {},
) => {
  void _powers;
  void _context;
  const path = options.env?.DB_PATH;
  if (path === undefined || path === '') {
    throw Error('DB_PATH must be set in the environment');
  }

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  let closed = false;
  /** @type {TransactionToken | undefined} */
  let activeTransaction;

  const assertOpen = () => {
    if (closed) {
      throw Error('SQLite database is closed');
    }
  };

  const assertRootOwnsConnection = () => {
    assertOpen();
    if (activeTransaction !== undefined) {
      throw Error('SQLite connection is owned by an active transaction');
    }
  };

  /** @param {TransactionToken} token */
  const assertTransactionOwnsConnection = token => {
    assertOpen();
    if (!token.active || activeTransaction !== token) {
      throw Error('SQLite transaction is no longer active');
    }
  };

  /**
   * @param {string} sql
   * @param {SqlValue[]} params
   */
  const execute = (sql, params) => {
    assertDataStatement(sql);
    const { changes, lastInsertRowid } = db.prepare(sql).run(...params);
    return harden({ changes, lastInsertRowid });
  };

  /**
   * @param {string} sql
   * @param {SqlValue[]} params
   */
  const query = (sql, params) => {
    assertDataStatement(sql);
    const rows = /** @type {Record<string, unknown>[]} */ (
      db.prepare(sql).all(...params)
    );
    return harden(rows.map(row => ({ ...row })));
  };

  /** @typedef {<T>(operation: () => T) => T} RunStatementOperation */

  /**
   * @template {SqlValue[]} [TParams=SqlValue[]]
   * @template [TRow=Record<string, unknown>]
   * @param {string} sql
   * @param {RunStatementOperation} runOperation
   * @returns {SqliteStatement<TParams, TRow>}
   */
  const prepare = (sql, runOperation) => {
    assertDataStatement(sql);
    const statement = db.prepare(sql);
    const statementExo = makeExo('SqliteStatement', SqliteStatementI, {
      run(...params) {
        return runOperation(() => {
          const sqlParams = /** @type {SqlValue[]} */ (
            /** @type {unknown} */ (params)
          );
          const { changes, lastInsertRowid } = statement.run(...sqlParams);
          return harden({ changes, lastInsertRowid });
        });
      },

      get(...params) {
        return runOperation(() => {
          const sqlParams = /** @type {SqlValue[]} */ (
            /** @type {unknown} */ (params)
          );
          const row = /** @type {Record<string, unknown> | undefined} */ (
            statement.get(...sqlParams)
          );
          if (row === undefined) {
            return undefined;
          }
          return harden({ ...row });
        });
      },

      all(...params) {
        return runOperation(() => {
          const sqlParams = /** @type {SqlValue[]} */ (
            /** @type {unknown} */ (params)
          );
          const rows = /** @type {Record<string, unknown>[]} */ (
            statement.all(...sqlParams)
          );
          return harden(rows.map(row => ({ ...row })));
        });
      },
    });
    return /** @type {SqliteStatement<TParams, TRow>} */ (
      /** @type {unknown} */ (statementExo)
    );
  };

  /** @type {RunStatementOperation} */
  const runRootStatementOperation = operation => {
    assertRootOwnsConnection();
    return operation();
  };

  /** @param {TransactionToken} token */
  const release = token => {
    token.active = false;
    if (activeTransaction === token) {
      activeTransaction = undefined;
    }
  };

  /**
   * Finish a transaction and release its ownership. If COMMIT fails, attempt
   * ROLLBACK before releasing the connection.
   *
   * @param {TransactionToken} token
   * @param {'COMMIT' | 'ROLLBACK'} command
   */
  const finish = (token, command) => {
    assertTransactionOwnsConnection(token);
    try {
      db.exec(command);
    } catch (error) {
      if (db.inTransaction) {
        try {
          db.exec('ROLLBACK');
        } catch {
          db.close();
          closed = true;
        }
      }
      throw error;
    } finally {
      release(token);
    }
  };

  const begin = () => {
    assertRootOwnsConnection();
    db.exec('BEGIN IMMEDIATE');
    /** @type {TransactionToken} */
    const token = { active: true, failed: false };
    activeTransaction = token;

    /**
     * Run one transaction operation. The first failure poisons the
     * transaction so an already-pipelined commit rolls it back.
     *
     * @template T
     * @param {() => T} operation
     * @returns {T}
     */
    const run = operation => {
      assertTransactionOwnsConnection(token);
      if (token.failed) {
        throw Error('SQLite transaction has failed; rollback is required');
      }
      try {
        return operation();
      } catch (error) {
        token.failed = true;
        token.failure = error;
        throw error;
      }
    };

    try {
      return makeExo('SqliteTransaction', SqliteTransactionI, {
        /**
         * @param {string} sql
         * @param {SqlValue[]} [params]
         */
        execute(sql, params = []) {
          return run(() => execute(sql, params));
        },

        /**
         * @param {string} sql
         * @param {SqlValue[]} [params]
         */
        query(sql, params = []) {
          return run(() => query(sql, params));
        },

        /**
         * @template {SqlValue[]} [TParams=SqlValue[]]
         * @template [TRow=Record<string, unknown>]
         * @param {string} sql
         * @returns {SqliteStatement<TParams, TRow>}
         */
        prepare(sql) {
          return run(() => prepare(sql, run));
        },

        commit() {
          assertTransactionOwnsConnection(token);
          if (token.failed) {
            const failure = token.failure;
            finish(token, 'ROLLBACK');
            const detail =
              failure instanceof Error ? `: ${failure.message}` : '';
            throw Error(`Cannot commit failed SQLite transaction${detail}`, {
              cause: failure,
            });
          }
          finish(token, 'COMMIT');
        },

        rollback() {
          finish(token, 'ROLLBACK');
        },
      });
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } finally {
        release(token);
      }
      throw error;
    }
  };

  return makeExo('SqliteDb', SqliteDbI, {
    /**
     * @param {string} sql
     * @param {SqlValue[]} [params]
     */
    execute(sql, params = []) {
      assertRootOwnsConnection();
      return execute(sql, params);
    },

    /**
     * @param {string} sql
     * @param {SqlValue[]} [params]
     */
    query(sql, params = []) {
      assertRootOwnsConnection();
      return query(sql, params);
    },

    /**
     * @template {SqlValue[]} [TParams=SqlValue[]]
     * @template [TRow=Record<string, unknown>]
     * @param {string} sql
     * @returns {SqliteStatement<TParams, TRow>}
     */
    prepare(sql) {
      assertRootOwnsConnection();
      return prepare(sql, runRootStatementOperation);
    },

    begin,

    close() {
      if (closed) {
        return;
      }
      if (activeTransaction !== undefined) {
        const token = activeTransaction;
        try {
          if (db.inTransaction) {
            db.exec('ROLLBACK');
          }
        } finally {
          release(token);
        }
      }
      db.close();
      closed = true;
    },
  });
};
harden(make);
