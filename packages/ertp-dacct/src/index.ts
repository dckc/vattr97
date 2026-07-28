import type { AsyncSqlDatabase } from './sql-db.js';
import { gcEmptySql } from './sql/gc_empty.js';
import { defaultZone, Nat } from './jessie-tools.js';
import type { Zone } from './jessie-tools.js';
import { makeDeterministicGuid } from './guids.js';
import type {
  AccountPurse,
  AmountLike,
  CreateIssuerConfig,
  Guid,
  NatIssuerKit,
  IssuerKitForCommodity,
  IssuerKitWithPurseGuids,
  OpenIssuerConfig,
} from './types.js';
import { makeChartFacet } from './chart.js';
import {
  createCommodityRow,
  ensureAccountRow,
  getAccountBalance,
  getCommodityAllegedName,
  makeTransferRecorder,
} from './db-helpers.js';
import { makePurseFactory } from './purse.js';
import { makeErtpEscrow } from './escrow-ertp.js';
import { makeSealerUnsealerPair } from './sealer.js';
import type { Sealed, Sealer, Unsealer } from './sealer.js';

export type { Sealed, Sealer, Unsealer } from './sealer.js';

export type {
  CommoditySpec,
  IssuerKitForCommodity,
  IssuerKitWithGuid,
  IssuerKitWithPurseGuids,
  NatIssuerKit,
} from './types.js';
export { asGuid } from './guids.js';
export { makeChartFacet } from './chart.js';
export { makeErtpEscrow } from './escrow-ertp.js';
export { makeSettlementFacet } from './settlement.js';
export type { SettlementFacet, SettlementResult } from './settlement.js';
export { wrapBetterSqlite3DatabaseAsync } from './sqlite-shim.js';
export type { AsyncSqlDatabase, AsyncSqlStatement } from './sql-db.js';
export type { Zone } from './jessie-tools.js';
export type { SlotRow } from './gnucash-schema.js';
export { SLOT_TYPE_GUID, SLOT_TYPE_STRING } from './gnucash-schema.js';

export const initGnuCashSchema = async (
  db: AsyncSqlDatabase,
  options: { allowTransactionStatements?: boolean } = {},
): Promise<void> => {
  const { allowTransactionStatements = true } = options;
  if (allowTransactionStatements) {
    await db.exec(gcEmptySql);
    return;
  }
  const sanitized = gcEmptySql
    .replace(/\bBEGIN TRANSACTION;\s*/gi, '')
    .replace(/\bCOMMIT;\s*/gi, '');
  await db.exec(sanitized);
};

export const ensureGnuCashSchema = async (
  db: AsyncSqlDatabase,
  options: { allowTransactionStatements?: boolean } = {},
): Promise<void> => {
  const row = await db
    .prepare<[string], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get('accounts');
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
  db: AsyncSqlDatabase;
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
  const commodityLabel = await getCommodityAllegedName(db, commodityGuid);
  const balanceAccountGuid = makeDeterministicGuid(
    `dacct-balance:${commodityGuid}`,
  );
  await ensureAccountRow({
    db,
    accountGuid: balanceAccountGuid,
    name: `${commodityLabel} Mint Holding`,
    commodityGuid,
    accountType: 'STOCK',
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
    accountType: 'STOCK',
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
      const rows = await db
        .prepare<[string], { guid: string }>('SELECT guid FROM transactions WHERE num = ?')
        .all(checkNumber);
      if (rows.length !== 1) {
        throw new Error('payment check number not unique');
      }
      const txGuid = rows[0]?.guid as Guid | undefined;
      if (!txGuid) {
        throw new Error('payment not found');
      }
      const holdingSplit = await db
        .prepare<
          [string, string],
          { guid: string; account_guid: string; quantity_num: string; reconcile_state: string }
        >(`
          SELECT guid, account_guid, quantity_num, reconcile_state
          FROM splits
          WHERE tx_guid = ? AND account_guid = ?
        `)
        .get(txGuid, balanceAccountGuid);
      if (!holdingSplit) {
        throw new Error('payment not live');
      }
      if (holdingSplit.reconcile_state !== 'n') {
        throw new Error('payment not live');
      }
      const sourceSplit = await db
        .prepare<
          [string, string],
          { account_guid: string }
        >(`
          SELECT account_guid
          FROM splits
          WHERE tx_guid = ? AND account_guid != ?
        `)
        .get(txGuid, balanceAccountGuid);
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

export const createIssuerKit = async (
  config: CreateIssuerConfig,
): Promise<IssuerKitWithPurseGuids> => {
  const { db, commodity, makeGuid, nowMs } = config;
  const zone = config.zone ?? defaultZone;
  const commodityGuid = makeGuid();
  await createCommodityRow({ db, guid: commodityGuid, commodity });
  const { sealer, unsealer } = makeSealerUnsealerPair();
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

export const openIssuerKit = async (
  config: OpenIssuerConfig,
): Promise<IssuerKitForCommodity> => {
  const { db, commodityGuid, makeGuid, nowMs } = config;
  const zone = config.zone ?? defaultZone;
  const { unsealer } = makeSealerUnsealerPair();
  return makeIssuerKitForCommodity({
    db,
    commodityGuid,
    makeGuid,
    nowMs,
    zone,
    unsealer,
  });
};
