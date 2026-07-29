import { E } from '@endo/eventual-send';
import type { ERef } from '@endo/eventual-send';
import type { DB } from './sql-db.ts';
import { dbAll, dbExecute, dbGet } from './sql-db.ts';
import { gcEmptySql } from './sql/gc_empty.ts';
import { defaultZone, Nat } from './jessie-tools.ts';
import type { Zone } from './jessie-tools.ts';
import { makeDeterministicGuid } from './guids.ts';
import type {
  AccountPurse,
  AmountLike,
  CreateIssuerConfig,
  Guid,
  NatIssuerKit,
  IssuerKitForCommodity,
  IssuerKitWithPurseGuids,
  OpenIssuerConfig,
} from './types.ts';
import { makeChartFacet } from './chart.ts';
import {
  createCommodityRow,
  ensureAccountRow,
  getAccountBalance,
  getCommodityAllegedName,
  getCommodityRow,
  makeTransferRecorder,
} from './db-helpers.ts';
import { makePurseFactory } from './purse.ts';
import { makeErtpEscrow } from './escrow-ertp.ts';
import { makeSealerUnsealerPair } from './sealer.ts';
import type { Sealed, Sealer, Unsealer } from './sealer.ts';

export type { Sealed, Sealer, Unsealer } from './sealer.ts';

export type {
  CommoditySpec,
  CreateIssuerConfig,
  OpenIssuerConfig,
  IssuerKitForCommodity,
  IssuerKitWithGuid,
  IssuerKitWithPurseGuids,
  NatIssuerKit,
} from './types.ts';
export { asGuid, mockMakeGuid } from './guids.ts';
export { makeChartFacet } from './chart.ts';
export { makeErtpEscrow } from './escrow-ertp.ts';
export { makeSettlementFacet } from './settlement.ts';
export type { SettlementFacet, SettlementResult } from './settlement.ts';
export { wrapBetterSqlite3DatabaseAsync } from './sqlite-shim.ts';
export type {
  AsyncSqlDatabase,
  AsyncSqlStatement,
  DB,
  DBRef,
} from './sql-db.ts';
export type { Zone } from './jessie-tools.ts';
export type { CommodityRow, SlotRow } from './gnucash-schema.ts';
export { SLOT_TYPE_GUID, SLOT_TYPE_STRING } from './gnucash-schema.ts';

export const initGnuCashSchema = async (
  db: ERef<DB>,
  options: { allowTransactionStatements?: boolean } = {},
): Promise<void> => {
  const { allowTransactionStatements = true } = options;
  const statements = gcEmptySql
    .split(/;\s*(?:\r?\n|$)/u)
    .map(statement => statement.trim())
    .filter(
      statement =>
        statement.length > 0 &&
        !/^(?:BEGIN TRANSACTION|COMMIT)$/iu.test(statement),
    );
  if (!allowTransactionStatements) {
    for (const statement of statements) {
      await dbExecute(db, statement);
    }
    return;
  }

  const pragmas = statements.filter(statement => /^PRAGMA\b/iu.test(statement));
  const transactionStatements = statements.filter(
    statement => !/^PRAGMA\b/iu.test(statement),
  );
  for (const pragma of pragmas) {
    await dbExecute(db, pragma);
  }
  const transactionRef = E(db).begin();
  try {
    for (const statement of transactionStatements) {
      await E(transactionRef).execute(statement);
    }
  } catch (error) {
    await E(transactionRef).rollback();
    throw error;
  }
  await E(transactionRef).commit();
};

export const ensureGnuCashSchema = async (
  db: ERef<DB>,
  options: { allowTransactionStatements?: boolean } = {},
): Promise<void> => {
  const row = await dbGet<[string], { name: string }>(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    'accounts',
  );
  if (!row) {
    await initGnuCashSchema(db, options);
  }
};

const makeIssuerKitForCommodity = async ({
  db,
  commodityGuid,
  makeGuid,
  nowMs,
  zone,
  unsealer,
}: {
  db: ERef<DB>;
  commodityGuid: Guid;
  makeGuid: () => Guid;
  nowMs: () => number;
  zone: Zone;
  unsealer: Unsealer;
}): Promise<IssuerKitForCommodity> => {
  const { exo } = zone;
  const { freeze } = Object;
  const displayInfo = freeze({ assetKind: 'nat' as const });
  const amountShape = freeze({});
  const paymentRecords = new WeakMap<
    object,
    {
      amount: bigint;
      live: boolean;
      sourceAccountGuid: Guid;
      txGuid: Guid;
      holdingSplitGuid: Guid;
      checkNumber: string;
    }
  >();
  const livePayments = new Set<object>();
  const assertAmount = (amount: AmountLike) => {
    if (amount.brand !== brand) {
      throw new Error('amount brand mismatch');
    }
    return Nat(amount.value);
  };
  const makeAmount = (value: bigint) => freeze({ brand, value: Nat(value) });
  const makePayment = (
    amount: AmountLike,
    sourceAccountGuid: Guid,
    txGuid: Guid,
    holdingSplitGuid: Guid,
    checkNumber: string,
  ) => {
    const amountValue = assertAmount(amount);
    const payment = exo(`${commodityLabel} Payment`, {
      __getAllegedInterface__: () => {
        throw new Error('not implemented');
      },
      [Symbol.dispose]: () => {
        const record = paymentRecords.get(payment as object);
        if (record?.live) {
          console.warn('dacct payment disposed while live', {
            checkNumber: record.checkNumber,
          });
        }
      },
    });
    paymentRecords.set(payment, {
      amount: amountValue,
      live: true,
      sourceAccountGuid,
      txGuid,
      holdingSplitGuid,
      checkNumber,
    });
    livePayments.add(payment as object);
    return payment;
  };
  const commodity = await getCommodityRow(db, commodityGuid);
  if (!commodity) {
    throw new Error('commodity not found');
  }
  const commodityLabel = getCommodityAllegedName(commodity);
  const internalAccountType =
    commodity.namespace === 'CURRENCY' ? 'BANK' : 'STOCK';
  const balanceAccountGuid = makeDeterministicGuid(
    `dacct-balance:${commodityGuid}`,
  );
  await ensureAccountRow({
    db,
    accountGuid: balanceAccountGuid,
    name: `${commodityLabel} Mint Holding`,
    commodityGuid,
    accountType: internalAccountType,
  });
  const transferRecorder = makeTransferRecorder({
    db,
    commodityGuid,
    holdingAccountGuid: balanceAccountGuid,
    makeGuid,
    nowMs,
  });
  const { ensurePurse, makeNewPurse, openPurse, purseGuids } = makePurseFactory(
    {
      db,
      commodityGuid,
      commodityLabel,
      makeAmount,
      makePayment,
      livePayments,
      paymentRecords,
      transferRecorder,
      getBrand: () => brand,
      zone,
    },
  );
  const brand = exo(`${commodityLabel} Brand`, {
    isMyIssuer: async (allegedIssuer: object) => allegedIssuer === issuer,
    getAllegedName: () => commodityLabel,
    getDisplayInfo: () => displayInfo,
    getAmountShape: () => amountShape,
  });
  const issuer = exo(`${commodityLabel} Issuer`, {
    getBrand: () => brand,
    getAllegedName: () => commodityLabel,
    getAssetKind: () => 'nat' as const,
    getDisplayInfo: () => displayInfo,
    makeEmptyPurse: async () => {
      const accountGuid = makeGuid();
      return makeNewPurse(accountGuid, accountGuid);
    },
    isLive: async (payment: object) =>
      paymentRecords.get(payment)?.live ?? false,
    getAmountOf: async (payment: object) =>
      makeAmount(paymentRecords.get(payment)?.amount ?? 0n),
    burn: async (payment: object) => {
      const record = paymentRecords.get(payment);
      if (!record?.live) throw new Error('payment not live');
      record.live = false;
      livePayments.delete(payment as object);
      await transferRecorder.finalizeHold({
        txGuid: record.txGuid,
        holdingSplitGuid: record.holdingSplitGuid,
        toAccountGuid: balanceAccountGuid,
      });
      return makeAmount(record.amount);
    },
  });
  const mintRecoveryGuid = makeDeterministicGuid(
    `dacct:recovery:${commodityGuid}`,
  );
  await ensureAccountRow({
    db,
    accountGuid: mintRecoveryGuid,
    name: `${commodityLabel} Mint Recovery`,
    commodityGuid,
    accountType: internalAccountType,
  });
  const mint = exo(`${commodityLabel} Mint`, {
    getIssuer: () => issuer,
    mintPayment: async (amount: AmountLike) => {
      const amountValue = assertAmount(amount);
      const { txGuid, holdingSplitGuid, checkNumber } =
        await transferRecorder.createHold({
          fromAccountGuid: mintRecoveryGuid,
          amount: amountValue,
        });
      return makePayment(
        amount,
        mintRecoveryGuid,
        txGuid,
        holdingSplitGuid,
        checkNumber,
      );
    },
  });
  const mintRecoveryPurse = await openPurse(
    mintRecoveryGuid,
    `${commodityLabel} Mint Recovery`,
  );
  const kit = freeze({
    brand,
    issuer,
    mint,
    mintRecoveryPurse,
    displayInfo,
  }) as unknown as NatIssuerKit;
  const mintInfo = exo('MintInfoAccess', {
    getMintInfo: () => ({
      holdingAccountGuid: balanceAccountGuid,
      recoveryPurseGuid: mintRecoveryGuid,
    }),
  });
  const payments = exo('PaymentAccess', {
    getCheckNumber: (payment: unknown) => {
      const record = paymentRecords.get(payment as object);
      if (!record) throw new Error('unknown payment');
      return record.checkNumber;
    },
    openPayment: async (checkNumber: string) => {
      const rows = await dbAll<[string], { guid: string }>(
        db,
        'SELECT guid FROM transactions WHERE num = ?',
        checkNumber,
      );
      if (rows.length !== 1) {
        throw new Error('payment check number not unique');
      }
      const txGuid = rows[0]?.guid as Guid | undefined;
      if (!txGuid) {
        throw new Error('payment not found');
      }
      const holdingSplit = await dbGet<
        [string, string],
        {
          guid: string;
          account_guid: string;
          quantity_num: string;
          reconcile_state: string;
        }
      >(
        db,
        `
          SELECT guid, account_guid, quantity_num, reconcile_state
          FROM splits
          WHERE tx_guid = ? AND account_guid = ?
        `,
        txGuid,
        balanceAccountGuid,
      );
      if (!holdingSplit) {
        throw new Error('payment not live');
      }
      if (holdingSplit.reconcile_state !== 'n') {
        throw new Error('payment not live');
      }
      const sourceSplit = await dbGet<
        [string, string],
        { account_guid: string }
      >(
        db,
        `
          SELECT account_guid
          FROM splits
          WHERE tx_guid = ? AND account_guid != ?
        `,
        txGuid,
        balanceAccountGuid,
      );
      if (!sourceSplit) {
        throw new Error('payment missing source split');
      }
      const amountValue = BigInt(holdingSplit.quantity_num);
      const amount = makeAmount(amountValue);
      return makePayment(
        amount,
        sourceSplit.account_guid as Guid,
        txGuid,
        holdingSplit.guid as Guid,
        checkNumber,
      );
    },
  });
  const accounts = exo('AccountAccess', {
    makeAccountPurse: async (accountGuid: Guid) => {
      if (accountGuid === balanceAccountGuid) {
        throw new Error('holding account is not externally accessible');
      }
      return makeNewPurse(accountGuid, accountGuid);
    },
    openAccountPurse: async (accountGuid: Guid) => {
      if (accountGuid === balanceAccountGuid) {
        throw new Error('holding account is not externally accessible');
      }
      return openPurse(accountGuid, accountGuid);
    },
  });
  return freeze({ kit, accounts, purseGuids, payments, mintInfo });
};

const makeIssuerKitWithPurseGuids = async ({
  db,
  commodityGuid,
  makeGuid,
  nowMs,
  zone,
}: {
  db: ERef<DB>;
  commodityGuid: Guid;
  makeGuid: () => Guid;
  nowMs: () => number;
  zone: Zone;
}): Promise<IssuerKitWithPurseGuids> => {
  const { sealer, unsealer } = makeSealerUnsealerPair(zone);
  const { kit, purseGuids, payments, mintInfo } =
    await makeIssuerKitForCommodity({
      db,
      commodityGuid,
      makeGuid,
      nowMs,
      zone,
      unsealer,
    });
  const purses = zone.exo('PurseGuids', {
    getGuid: (purse: unknown) => {
      const guid = purseGuids.get(purse as AccountPurse);
      if (!guid) throw new Error('unknown purse');
      return guid;
    },
    getGuidFromSealed: (sealedPurse: unknown) => {
      const purse = unsealer.unseal(sealedPurse) as AccountPurse;
      const guid = purseGuids.get(purse);
      if (!guid) throw new Error('unknown sealed purse');
      return guid;
    },
  });
  return Object.freeze({
    ...kit,
    commodityGuid,
    purses,
    payments,
    mintInfo,
    sealer,
  }) as IssuerKitWithPurseGuids;
};

export const createIssuerKit = async (
  config: CreateIssuerConfig,
): Promise<IssuerKitWithPurseGuids> => {
  const { db, commodity, makeGuid, nowMs } = config;
  const zone = config.zone ?? defaultZone;
  const commodityGuid = makeGuid();
  await createCommodityRow({ db, guid: commodityGuid, commodity });
  return makeIssuerKitWithPurseGuids({
    db,
    commodityGuid,
    makeGuid,
    nowMs,
    zone,
  });
};

export const openIssuerKitWithPurseGuids = async (
  config: OpenIssuerConfig,
): Promise<IssuerKitWithPurseGuids> => {
  const { db, commodityGuid, makeGuid, nowMs } = config;
  return makeIssuerKitWithPurseGuids({
    db,
    commodityGuid,
    makeGuid,
    nowMs,
    zone: config.zone ?? defaultZone,
  });
};

export const openIssuerKit = async (
  config: OpenIssuerConfig,
): Promise<IssuerKitForCommodity> => {
  const { db, commodityGuid, makeGuid, nowMs } = config;
  const zone = config.zone ?? defaultZone;
  const { unsealer } = makeSealerUnsealerPair(zone);
  return makeIssuerKitForCommodity({
    db,
    commodityGuid,
    makeGuid,
    nowMs,
    zone,
    unsealer,
  });
};
