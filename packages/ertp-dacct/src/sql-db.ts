import { E } from '@endo/eventual-send';
import type { ERef } from '@endo/eventual-send';
import type {
  SqliteDb,
  SqliteResult,
  SqliteStatement,
  SqlValue,
} from '@finquick/sqlite-plugin';

export type DB = SqliteDb;
export type DBRef = ERef<DB>;

/** @deprecated Import `SqliteStatement` from `@finquick/sqlite-plugin`. */
export type AsyncSqlStatement<
  TParams extends SqlValue[] = SqlValue[],
  TRow = Record<string, unknown>,
> = SqliteStatement<TParams, TRow>;

/** @deprecated Use `DB` instead. */
export type AsyncSqlDatabase = DB;

export const dbExecute = (
  db: DBRef,
  sql: string,
  params: SqlValue[] = [],
): Promise<SqliteResult> => E(db).execute(sql, params);

export const dbRun = <
  TParams extends SqlValue[] = SqlValue[],
  TRow = Record<string, unknown>,
>(
  db: DBRef,
  sql: string,
  ...params: TParams
): Promise<SqliteResult> => {
  const statementRef = E(db).prepare(sql) as Promise<
    SqliteStatement<TParams, TRow>
  >;
  return E(statementRef).run(...params);
};

export const dbGet = <
  TParams extends SqlValue[] = SqlValue[],
  TRow = Record<string, unknown>,
>(
  db: DBRef,
  sql: string,
  ...params: TParams
): Promise<TRow | undefined> => {
  const statementRef = E(db).prepare(sql) as Promise<
    SqliteStatement<TParams, TRow>
  >;
  return E(statementRef).get(...params) as Promise<TRow | undefined>;
};

export const dbAll = <
  TParams extends SqlValue[] = SqlValue[],
  TRow = Record<string, unknown>,
>(
  db: DBRef,
  sql: string,
  ...params: TParams
): Promise<TRow[]> => {
  const statementRef = E(db).prepare(sql) as Promise<
    SqliteStatement<TParams, TRow>
  >;
  return E(statementRef).all(...params);
};
