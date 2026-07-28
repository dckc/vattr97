import type { AsyncSqlDatabase } from './sql-db.js';
import type { Guid } from './types.js';

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
  db: AsyncSqlDatabase;
  currencyGuid: Guid;
  makeSettlementRef: () => string;
}): SettlementFacet => {
  return freeze({
    settle: async <T>(
      operation: () => Promise<T>,
      description?: string,
    ): Promise<SettlementResult<T>> => {
      const settlementRef = makeSettlementRef();

      const beforeRow = await db
        .prepare<[], { max_guid: string | null }>(
          'SELECT MAX(guid) as max_guid FROM transactions',
        )
        .get();
      const beforeGuid = beforeRow?.max_guid ?? '';

      const result = await operation();

      const newTxs = await db
        .prepare<[string], { guid: string; currency_guid: string }>(
          'SELECT guid, currency_guid FROM transactions WHERE guid > ?',
        )
        .all(beforeGuid);

      if (newTxs.length < 2) {
        return freeze({ result, settlementRef, txGuid: newTxs[0]?.guid });
      }

      const currencyTx = newTxs.find(tx => tx.currency_guid === currencyGuid);
      const otherTxs = newTxs.filter(tx => tx.guid !== currencyTx?.guid);

      if (!currencyTx) {
        throw new Error('No currency transaction found to consolidate into');
      }

      const currencyTotal = await db
        .prepare<[string], { total: string }>(
          `SELECT SUM(value_num) as total FROM splits
           WHERE tx_guid = ? AND value_num > 0`,
        )
        .get(currencyTx.guid);
      const currencyAmount = BigInt(currencyTotal?.total ?? '0');

      const txGuids = newTxs.map(tx => tx.guid);
      const [firstTxGuid, ...restTxGuids] = txGuids;
      const pendingSplits = await db
        .prepare<[string, ...string[]], { count: number }>(
          `SELECT COUNT(*) as count FROM splits
           WHERE tx_guid IN (${newTxs.map(() => '?').join(',')})
           AND reconcile_state != 'c'`,
        )
        .get(firstTxGuid, ...restTxGuids);
      if (pendingSplits && pendingSplits.count > 0) {
        throw new Error(
          'Cannot consolidate: found pending (non-cleared) splits',
        );
      }

      for (const tx of otherTxs) {
        const commodityTotal = await db
          .prepare<[string], { total: string }>(
            `SELECT SUM(quantity_num) as total FROM splits
             WHERE tx_guid = ? AND quantity_num > 0`,
          )
          .get(tx.guid);
        const commodityAmount = BigInt(commodityTotal?.total ?? '1');

        const rate = currencyAmount / commodityAmount;

        await db.prepare(
          `UPDATE splits SET
             tx_guid = ?,
             value_num = quantity_num * ?,
             value_denom = quantity_denom
           WHERE tx_guid = ?`,
        ).run(currencyTx.guid, rate.toString(), tx.guid);

        await db.prepare('DELETE FROM transactions WHERE guid = ?').run(tx.guid);
      }

      if (description) {
        await db.prepare(
          'UPDATE transactions SET num = ?, description = ? WHERE guid = ?',
        ).run(settlementRef, description, currencyTx.guid);
      } else {
        await db.prepare('UPDATE transactions SET num = ? WHERE guid = ?').run(
          settlementRef,
          currencyTx.guid,
        );
      }

      return freeze({ result, settlementRef, txGuid: currencyTx.guid });
    },
  });
};
