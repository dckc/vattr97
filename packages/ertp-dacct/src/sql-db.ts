export type AsyncSqlStatement<
  TParams extends unknown[] = unknown[],
  TRow = unknown,
> = {
  run: (...params: TParams) => Promise<any>;
  get: (...params: TParams) => Promise<TRow | undefined>;
  all: (...params: TParams) => Promise<TRow[]>;
};

export type AsyncSqlDatabase = {
  exec: (sql: string) => Promise<void>;
  prepare: <TParams extends unknown[] = unknown[], TRow = unknown>(
    sql: string,
  ) => AsyncSqlStatement<TParams, TRow>;
};
