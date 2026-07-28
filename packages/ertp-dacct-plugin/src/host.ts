import Database from 'better-sqlite3';
import { wrapBetterSqlite3DatabaseAsync } from '@finquick/ertp-dacct';
import type { AsyncSqlDatabase } from '@finquick/ertp-dacct';

export type DacctDb = {
  db: AsyncSqlDatabase;
  rawDb: Database.Database;
  close: () => void;
};

export const createDacctDb = (path: string): DacctDb => {
  const rawDb = new Database(path);
  rawDb.pragma('journal_mode = WAL');
  rawDb.pragma('foreign_keys = ON');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  return {
    db,
    rawDb,
    close: () => rawDb.close(),
  };
};
