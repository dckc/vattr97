export type SqlValue = string | number | bigint | null | Uint8Array;

export type SqliteResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

export type SqliteStatement<
  TParams extends SqlValue[] = SqlValue[],
  TRow = Record<string, unknown>,
> = {
  run: (...params: TParams) => SqliteResult;
  get: (...params: TParams) => TRow | undefined;
  all: (...params: TParams) => TRow[];
};

export type SqliteTransaction = {
  execute: (sql: string, params?: SqlValue[]) => SqliteResult;
  query: (sql: string, params?: SqlValue[]) => Record<string, unknown>[];
  prepare: <
    TParams extends SqlValue[] = SqlValue[],
    TRow = Record<string, unknown>,
  >(
    sql: string,
  ) => SqliteStatement<TParams, TRow>;
  commit: () => void;
  rollback: () => void;
};

export type SqliteDb = {
  execute: (sql: string, params?: SqlValue[]) => SqliteResult;
  query: (sql: string, params?: SqlValue[]) => Record<string, unknown>[];
  prepare: <
    TParams extends SqlValue[] = SqlValue[],
    TRow = Record<string, unknown>,
  >(
    sql: string,
  ) => SqliteStatement<TParams, TRow>;
  begin: () => SqliteTransaction;
  close: () => void;
};

export declare const make: (
  powers?: unknown,
  context?: unknown,
  options?: { env?: Record<string, string> },
) => SqliteDb;
