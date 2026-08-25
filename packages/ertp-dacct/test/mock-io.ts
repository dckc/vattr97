import Database from 'better-sqlite3';
import { Far } from '@endo/far';
import {
  initGnuCashSchema,
  wrapBetterSqlite3DatabaseAsync,
} from '../src/index.js';
import type { Guid } from '../src/types.js';
import type { Clock } from '../src/types.js';

const asGuid = (value: string): Guid => value as Guid;

export const makeTestClock = (
  startMs = Date.UTC(2020, 0, 1, 9, 15),
  stepDays = 3,
): Clock => {
  const stepMs = stepDays * 24 * 60 * 60 * 1000;
  let now = startMs;
  return Far('test clock', {
    now: () => {
      const current = now;
      now += stepMs;
      return current;
    },
  });
};

export const mockMakeGuid = (start: bigint = 0n): (() => Guid) => {
  let counter = start;
  return () => {
    const guid = counter;
    counter += 1n;
    return asGuid(guid.toString(16).padStart(32, '0'));
  };
};

export const makeTestDb = async () => {
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  await initGnuCashSchema(db);
  return { db, close: () => rawDb.close() };
};
