import { dbAll, dbGet, dbRun } from './sql-db.ts';
import type { DBRef } from './sql-db.ts';
import type { Guid } from './types.ts';

const { freeze } = Object;

export type SettlementResult<T> = Readonly<{
  result: T;
  settlementRef: string;
  txGuid?: string;
}>;

export type SettlementFacet = Readonly<{
  settle: <T>(
    operation: () => Promise<T>,
    description?: string,
  ) => Promise<SettlementResult<T>>;
}>;

export const makeSettlementFacet = ({
  db,
  currencyGuid,
  makeSettlementRef,
}: {
  db: DBRef;
  currencyGuid: Guid;
  makeSettlementRef: () => string;
}): SettlementFacet => {
  return freeze({
    settle: async <T>(
      operation: () => Promise<T>,
      description?: string,
    ): Promise<SettlementResult<T>> => {
      const settlementRef = makeSettlementRef();

      const beforeRow = await dbGet<[], { max_guid: string | null }>(
        db,
        'SELECT MAX(guid) as max_guid FROM transactions',
      );
      const beforeGuid = beforeRow?.max_guid ?? '';

      const result = await operation();

      const newTxs = await dbAll<
        [string],
        { guid: string; currency_guid: string }
      >(
        db,
        'SELECT guid, currency_guid FROM transactions WHERE guid > ?',
        beforeGuid,
      );

      if (newTxs.length < 2) {
        return freeze({ result, settlementRef, txGuid: newTxs[0]?.guid });
      }

      const currencyTx = newTxs.find(tx => tx.currency_guid === currencyGuid);
      const otherTxs = newTxs.filter(tx => tx.guid !== currencyTx?.guid);

      if (!currencyTx) {
        throw new Error('No currency transaction found to consolidate into');
      }

      const currencyTotal = await dbGet<[string], { total: string }>(
        db,
        `SELECT SUM(value_num) as total FROM splits
         WHERE tx_guid = ? AND value_num > 0`,
        currencyTx.guid,
      );
      const currencyAmount = BigInt(currencyTotal?.total ?? '0');

      const txGuids = newTxs.map(tx => tx.guid);
      const [firstTxGuid, ...restTxGuids] = txGuids;
      const pendingSplits = await dbGet<
        [string, ...string[]],
        { count: number }
      >(
        db,
        `SELECT COUNT(*) as count FROM splits
         WHERE tx_guid IN (${newTxs.map(() => '?').join(',')})
         AND reconcile_state != 'c'`,
        firstTxGuid,
        ...restTxGuids,
      );
      if (pendingSplits && pendingSplits.count > 0) {
        throw new Error(
          'Cannot consolidate: found pending (non-cleared) splits',
        );
      }

      for (const tx of otherTxs) {
        const commodityTotal = await dbGet<[string], { total: string }>(
          db,
          `SELECT SUM(quantity_num) as total FROM splits
           WHERE tx_guid = ? AND quantity_num > 0`,
          tx.guid,
        );
        const commodityAmount = BigInt(commodityTotal?.total ?? '1');

        const rate = currencyAmount / commodityAmount;

        await dbRun(
          db,
          `UPDATE splits SET
             tx_guid = ?,
             value_num = quantity_num * ?,
             value_denom = quantity_denom
           WHERE tx_guid = ?`,
          currencyTx.guid,
          rate.toString(),
          tx.guid,
        );

        await dbRun(db, 'DELETE FROM transactions WHERE guid = ?', tx.guid);
      }

      if (description) {
        await dbRun(
          db,
          'UPDATE transactions SET num = ?, description = ? WHERE guid = ?',
          settlementRef,
          description,
          currencyTx.guid,
        );
      } else {
        await dbRun(
          db,
          'UPDATE transactions SET num = ? WHERE guid = ?',
          settlementRef,
          currencyTx.guid,
        );
      }

      return freeze({ result, settlementRef, txGuid: currencyTx.guid });
    },
  });
};
