import { dbAll, dbGet, dbRun } from './sql-db.js';
import type { DBRef } from './sql-db.js';
import type { CommoditySpec, Guid } from './types.js';
import type { CommodityRow } from './gnucash-schema.js';

export const ensureCommodityRow = async (
  db: DBRef,
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
  const identityRow = await dbGet<[string, string], { guid: string }>(
    db,
    `
      SELECT guid FROM commodities
      WHERE namespace = ? AND mnemonic = ?
    `,
    namespace,
    mnemonic,
  );
  if (identityRow && identityRow.guid !== guid) {
    throw new Error('commodity already exists');
  }
  await dbRun(
    db,
    `
    INSERT OR IGNORE INTO commodities(
      guid, namespace, mnemonic, fullname, cusip, fraction, quote_flag, quote_source, quote_tz
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL)
  `,
    guid,
    namespace,
    mnemonic,
    fullname,
    fraction,
    quoteFlag,
  );
};

export const createCommodityRow = async ({
  db,
  guid,
  commodity,
}: {
  db: DBRef;
  guid: Guid;
  commodity: CommoditySpec;
}): Promise<void> => {
  const {
    namespace = 'COMMODITY',
    mnemonic,
    fullname = mnemonic,
    fraction = 1,
    quoteFlag = 0,
  } = commodity;
  const row = await dbGet<[string, string, string], { guid: string }>(
    db,
    `
      SELECT guid FROM commodities
      WHERE guid = ? OR (namespace = ? AND mnemonic = ?)
    `,
    guid,
    namespace,
    mnemonic,
  );
  if (row) {
    throw new Error('commodity already exists');
  }
  await dbRun(
    db,
    `
    INSERT INTO commodities(
      guid, namespace, mnemonic, fullname, cusip, fraction, quote_flag, quote_source, quote_tz
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL)
  `,
    guid,
    namespace,
    mnemonic,
    fullname,
    fraction,
    quoteFlag,
  );
};

export const getCommodityRow = (
  db: DBRef,
  commodityGuid: Guid,
): Promise<CommodityRow | undefined> =>
  dbGet<[string], CommodityRow>(
    db,
    'SELECT * FROM commodities WHERE guid = ?',
    commodityGuid,
  );

const getCommodityFraction = async (
  db: DBRef,
  commodityGuid: Guid,
): Promise<number> => {
  const row = await getCommodityRow(db, commodityGuid);
  if (!row) {
    throw new Error('commodity not found');
  }
  return row.fraction;
};

export const ensureAccountRow = async ({
  db,
  accountGuid,
  name,
  commodityGuid,
  accountType = 'ASSET',
  parentGuid = null,
}: {
  db: DBRef;
  accountGuid: Guid;
  name: string;
  commodityGuid: Guid;
  accountType?: string;
  parentGuid?: Guid | null;
}): Promise<void> => {
  const commodityScu = await getCommodityFraction(db, commodityGuid);
  await dbRun(
    db,
    `
    INSERT OR IGNORE INTO accounts(
      guid, name, account_type, commodity_guid, commodity_scu, non_std_scu,
      parent_guid, code, description, hidden, placeholder
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0)
  `,
    accountGuid,
    name,
    accountType,
    commodityGuid,
    commodityScu,
    0,
    parentGuid,
  );
};

export const createAccountRow = async ({
  db,
  accountGuid,
  name,
  commodityGuid,
  accountType = 'ASSET',
  parentGuid = null,
}: {
  db: DBRef;
  accountGuid: Guid;
  name: string;
  commodityGuid: Guid;
  accountType?: string;
  parentGuid?: Guid | null;
}): Promise<void> => {
  const row = await dbGet<[string], { guid: string }>(
    db,
    'SELECT guid FROM accounts WHERE guid = ?',
    accountGuid,
  );
  if (row) {
    throw new Error('account already exists');
  }
  const commodityScu = await getCommodityFraction(db, commodityGuid);
  await dbRun(
    db,
    `
    INSERT INTO accounts(
      guid, name, account_type, commodity_guid, commodity_scu, non_std_scu,
      parent_guid, code, description, hidden, placeholder
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0)
  `,
    accountGuid,
    name,
    accountType,
    commodityGuid,
    commodityScu,
    0,
    parentGuid,
  );
};

export const requireAccountCommodity = async ({
  db,
  accountGuid,
  commodityGuid,
}: {
  db: DBRef;
  accountGuid: Guid;
  commodityGuid: Guid;
}): Promise<void> => {
  const row = await dbGet<[string], { commodity_guid: string }>(
    db,
    'SELECT commodity_guid FROM accounts WHERE guid = ?',
    accountGuid,
  );
  if (!row) {
    throw new Error('account not found');
  }
  if (row.commodity_guid !== commodityGuid) {
    throw new Error('account commodity mismatch');
  }
};

export const getCommodityAllegedName = (
  row: CommodityRow | undefined,
): string => row?.fullname || row?.mnemonic || 'GnuCash';

export const getAccountBalance = async (
  db: DBRef,
  accountGuid: Guid,
): Promise<bigint> => {
  const row = await dbGet<[string], { qty: string }>(
    db,
    'SELECT COALESCE(SUM(quantity_num), 0) AS qty FROM splits WHERE account_guid = ?',
    accountGuid,
  );
  return row ? BigInt(row.qty) : 0n;
};

export const makeTransferRecorder = ({
  db,
  commodityGuid,
  holdingAccountGuid,
  makeGuid,
  nowMs,
}: {
  db: DBRef;
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
    const rows = await dbAll<[string, string], { num: string }>(
      db,
      'SELECT num FROM transactions WHERE num = ? OR num LIKE ?',
      base,
      `${base}.%`,
    );
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
    await dbRun(
      db,
      `
      INSERT INTO splits(
        guid, tx_guid, account_guid, memo, action, reconcile_state, reconcile_date,
        value_num, value_denom, quantity_num, quantity_denom, lot_guid
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)
    `,
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
    await dbRun(
      db,
      `
      INSERT INTO transactions(guid, currency_guid, num, post_date, enter_date, description)
      VALUES (?, ?, ?, datetime(date(?, 'unixepoch')), datetime(date(?, 'unixepoch')), ?)
    `,
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
    await dbRun(
      db,
      'UPDATE splits SET account_guid = ?, reconcile_state = ? WHERE guid = ?',
      toAccountGuid,
      'c',
      holdingSplitGuid,
    );
    await dbRun(
      db,
      'UPDATE splits SET reconcile_state = ? WHERE tx_guid = ?',
      'c',
      txGuid,
    );
  };

  return { createHold, finalizeHold };
};
