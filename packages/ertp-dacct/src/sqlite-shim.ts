import type { Database } from 'better-sqlite3';
import type {
  SqliteDb,
  SqliteResult,
  SqliteStatement,
  SqliteTransaction,
  SqlValue,
} from '@finquick/sqlite-plugin';

type BetterSqliteStatement = {
  run: (...params: SqlValue[]) => {
    changes: number;
    lastInsertRowid: number | bigint;
  };
  get: (...params: SqlValue[]) => unknown;
  all: (...params: SqlValue[]) => unknown[];
};

const wrapStatement = <
  TParams extends SqlValue[] = SqlValue[],
  TRow = Record<string, unknown>,
>(
  statement: BetterSqliteStatement,
): SqliteStatement<TParams, TRow> => ({
  run: (...params: TParams): SqliteResult => {
    const { changes, lastInsertRowid } = statement.run(...params);
    return { changes, lastInsertRowid };
  },
  get: (...params: TParams): TRow | undefined =>
    statement.get(...params) as TRow | undefined,
  all: (...params: TParams): TRow[] => statement.all(...params) as TRow[],
});

/**
 * Adapt a local better-sqlite3 connection to the remotable SQLite interface.
 *
 * @deprecated Production callers should use `@finquick/sqlite-plugin`.
 */
export const wrapBetterSqlite3DatabaseAsync = (db: Database): SqliteDb => {
  const prepare = <
    TParams extends SqlValue[] = SqlValue[],
    TRow = Record<string, unknown>,
  >(
    sql: string,
  ): SqliteStatement<TParams, TRow> =>
    wrapStatement<TParams, TRow>(
      db.prepare(sql) as unknown as BetterSqliteStatement,
    );
  const execute = (sql: string, params: SqlValue[] = []): SqliteResult =>
    prepare(sql).run(...params);
  const query = (
    sql: string,
    params: SqlValue[] = [],
  ): Record<string, unknown>[] => prepare(sql).all(...params);

  return {
    execute,
    query,
    prepare,
    begin: (): SqliteTransaction => {
      db.exec('BEGIN IMMEDIATE');
      return {
        execute,
        query,
        prepare,
        commit: () => {
          db.exec('COMMIT');
        },
        rollback: () => {
          db.exec('ROLLBACK');
        },
      };
    },
    close: () => {
      db.close();
    },
  };
};
