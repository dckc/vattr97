import type { Database } from 'better-sqlite3';
import type { AsyncSqlDatabase, AsyncSqlStatement } from './sql-db.js';

type BetterSqliteStatement = {
  run: (...args: any[]) => unknown;
  get: (...args: any[]) => unknown;
  all: (...args: any[]) => unknown;
};

const wrapStatement = <TParams extends unknown[] = unknown[], TRow = unknown>(
  statement: BetterSqliteStatement,
): AsyncSqlStatement<TParams, TRow> => {
  const callAsync = (method: keyof BetterSqliteStatement, params: unknown[]) => {
    try {
      if (params.length === 0) {
        return Promise.resolve(statement[method]());
      }
      if (params.length === 1) {
        return Promise.resolve(statement[method](params[0]));
      }
      return Promise.resolve(statement[method](params));
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  };
  return {
    run: (...params: unknown[]) => callAsync('run', params),
    get: (...params: unknown[]) => callAsync('get', params) as Promise<TRow | undefined>,
    all: (...params: unknown[]) => callAsync('all', params) as Promise<TRow[]>,
  };
};

export const wrapBetterSqlite3DatabaseAsync = (db: Database): AsyncSqlDatabase => ({
  exec: (sql: string) => {
    try {
      db.exec(sql);
      return Promise.resolve();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  },
  prepare: <TParams extends unknown[] = unknown[], TRow = unknown>(sql: string) =>
    wrapStatement<TParams, TRow>(db.prepare(sql) as BetterSqliteStatement),
});
