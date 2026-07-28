import type { AsyncSqlDatabase } from './sql-db.js';
import type { CommoditySpec, Guid } from './types.js';

export const ensureCommodityRow = async (
  db: AsyncSqlDatabase,
  guid: Guid,
  commodity: CommoditySpec,
): Promise<void> => {
  const {
    namespace = 'COMMODITY',
    mnemonic,
    fullname = mnemonic,
    fraction = 1,
    quoteFlag = 0,
  } = commodity;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO commodities(
      guid, namespace, mnemonic, fullname, cusip, fraction, quote_flag, quote_source, quote_tz
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL)
  `);
  await insert.run(guid, namespace, mnemonic, fullname, fraction, quoteFlag);
};

export const createCommodityRow = async ({
  db,
  guid,
  commodity,
}: {
  db: AsyncSqlDatabase;
  guid: Guid;
  commodity: CommoditySpec;
}): Promise<void> => {
  const row = await db
    .prepare<[string], { guid: string }>('SELECT guid FROM commodities WHERE guid = ?')
    .get(guid);
  if (row) {
    throw new Error('commodity already exists');
  }
  const {
    namespace = 'COMMODITY',
    mnemonic,
    fullname = mnemonic,
    fraction = 1,
    quoteFlag = 0,
  } = commodity;
  const insert = db.prepare(`
    INSERT INTO commodities(
      guid, namespace, mnemonic, fullname, cusip, fraction, quote_flag, quote_source, quote_tz
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL)
  `);
  await insert.run(guid, namespace, mnemonic, fullname, fraction, quoteFlag);
};

export const ensureAccountRow = async ({
  db,
  accountGuid,
  name,
  commodityGuid,
  accountType = 'ASSET',
  parentGuid = null,
}: {
  db: AsyncSqlDatabase;
  accountGuid: Guid;
  name: string;
  commodityGuid: Guid;
  accountType?: string;
  parentGuid?: Guid | null;
}): Promise<void> => {
  await db.prepare(`
    INSERT OR IGNORE INTO accounts(
      guid, name, account_type, commodity_guid, commodity_scu, non_std_scu,
      parent_guid, code, description, hidden, placeholder
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0)
  `).run(accountGuid, name, accountType, commodityGuid, 1, 0, parentGuid);
};

export const createAccountRow = async ({
  db,
  accountGuid,
  name,
  commodityGuid,
  accountType = 'ASSET',
  parentGuid = null,
}: {
  db: AsyncSqlDatabase;
  accountGuid: Guid;
  name: string;
  commodityGuid: Guid;
  accountType?: string;
  parentGuid?: Guid | null;
}): Promise<void> => {
  const row = await db
    .prepare<[string], { guid: string }>('SELECT guid FROM accounts WHERE guid = ?')
    .get(accountGuid);
  if (row) {
    throw new Error('account already exists');
  }
  await db.prepare(`
    INSERT INTO accounts(
      guid, name, account_type, commodity_guid, commodity_scu, non_std_scu,
      parent_guid, code, description, hidden, placeholder
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0)
  `).run(accountGuid, name, accountType, commodityGuid, 1, 0, parentGuid);
};

export const requireAccountCommodity = async ({
  db,
  accountGuid,
  commodityGuid,
}: {
  db: AsyncSqlDatabase;
  accountGuid: Guid;
  commodityGuid: Guid;
}): Promise<void> => {
  const row = await db
    .prepare<[string], { commodity_guid: string }>(
      'SELECT commodity_guid FROM accounts WHERE guid = ?',
    )
    .get(accountGuid);
  if (!row) {
    throw new Error('account not found');
  }
  if (row.commodity_guid !== commodityGuid) {
    throw new Error('account commodity mismatch');
  }
};

export const getCommodityAllegedName = async (
  db: AsyncSqlDatabase,
  commodityGuid: Guid,
): Promise<string> => {
  const row = await db
    .prepare<[string], { fullname: string | null; mnemonic: string }>(
      'SELECT fullname, mnemonic FROM commodities WHERE guid = ?',
    )
    .get(commodityGuid);
  return row?.fullname || row?.mnemonic || 'GnuCash';
};

export const getAccountBalance = async (
  db: AsyncSqlDatabase,
  accountGuid: Guid,
): Promise<bigint> => {
  const row = await db
    .prepare<[string], { qty: string }>(
      'SELECT COALESCE(SUM(quantity_num), 0) AS qty FROM splits WHERE account_guid = ?',
    )
    .get(accountGuid);
  return row ? BigInt(row.qty) : 0n;
};

export const makeTransferRecorder = ({
  db,
  commodityGuid,
  holdingAccountGuid,
  makeGuid,
  nowMs,
}: {
  db: AsyncSqlDatabase;
  commodityGuid: Guid;
  holdingAccountGuid: Guid;
  makeGuid: () => Guid;
  nowMs: () => number;
}) => {
  const formatCheckNumber = (nowMsValue: number) => {
    const date = new Date(nowMsValue);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const resolveCheckNumber = async (base: string) => {
    const rows = await db
      .prepare<[string, string], { num: string }>(
        'SELECT num FROM transactions WHERE num = ? OR num LIKE ?',
      )
      .all(base, `${base}.%`);
    if (rows.length === 0) return base;
    let maxSuffix = 1;
    for (const row of rows) {
      if (row.num === base) continue;
      const suffix = Number(row.num.slice(base.length + 1));
      if (Number.isInteger(suffix) && suffix > maxSuffix) {
        maxSuffix = suffix;
      }
    }
    return `${base}.${maxSuffix + 1}`;
  };

  const recordSplit = async (
    txGuid: Guid,
    accountGuid: Guid,
    amount: bigint,
    reconcileState = 'n',
  ) => {
    const splitGuid = makeGuid();
    await db.prepare(`
      INSERT INTO splits(
        guid, tx_guid, account_guid, memo, action, reconcile_state, reconcile_date,
        value_num, value_denom, quantity_num, quantity_denom, lot_guid
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)
    `).run(
      splitGuid,
      txGuid,
      accountGuid,
      '',
      '',
      reconcileState,
      amount.toString(),
      1,
      amount.toString(),
      1,
    );
    return splitGuid;
  };

  const recordTransaction = async (
    txGuid: Guid,
    amount: bigint,
    checkNumber: string,
    nowMsValue: number,
  ) => {
    const seconds = Math.floor(nowMsValue / 1000);
    await db.prepare(`
      INSERT INTO transactions(guid, currency_guid, num, post_date, enter_date, description)
      VALUES (?, ?, ?, datetime(date(?, 'unixepoch')), datetime(date(?, 'unixepoch')), ?)
    `).run(
      txGuid,
      commodityGuid,
      checkNumber,
      seconds,
      seconds,
      `dacct ${amount.toString()}`,
    );
  };

  const createHold = async ({
    fromAccountGuid,
    amount,
  }: {
    fromAccountGuid: Guid;
    amount: bigint;
  }) => {
    const nowMsValue = nowMs();
    const txGuid = makeGuid();
    const resolvedCheckNumber = await resolveCheckNumber(
      formatCheckNumber(nowMsValue),
    );
    await recordTransaction(txGuid, amount, resolvedCheckNumber, nowMsValue);
    const holdingSplitGuid = await recordSplit(
      txGuid,
      holdingAccountGuid,
      amount,
      'n',
    );
    await recordSplit(txGuid, fromAccountGuid, -amount, 'n');
    return { txGuid, holdingSplitGuid, checkNumber: resolvedCheckNumber };
  };

  const finalizeHold = async ({
    txGuid,
    holdingSplitGuid,
    toAccountGuid,
  }: {
    txGuid: Guid;
    holdingSplitGuid: Guid;
    toAccountGuid: Guid;
  }) => {
    await db.prepare(
      'UPDATE splits SET account_guid = ?, reconcile_state = ? WHERE guid = ?',
    ).run(toAccountGuid, 'c', holdingSplitGuid);
    await db.prepare('UPDATE splits SET reconcile_state = ? WHERE tx_guid = ?').run('c', txGuid);
  };

  return { createHold, finalizeHold };
};
