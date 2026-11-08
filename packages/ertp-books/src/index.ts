/**
 * @file ERTP facade backed by a GnuCash sqlite database.
 *
 * Table of contents (entry points):
 * @see initGnuCashSchema
 * @see createIssuerKit
 * @see openIssuerKit
 */

import type { SqlDatabase } from './sql-db.js';
import { gcEmptySql } from './sql/gc_empty.js';
import type { MapStore, Zone } from '@vattr/toybox/src/types.js';
import { Nat } from './jessie-tools.js';
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
// import { makeEscrow } from './escrow.js'; // This is the old, "all over the floor" escrow
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
export { makeEscrows } from './escrow-seats.js';
export type { Side } from './escrow-seats.js';
export { makeSettlementFacet } from './settlement.js';
export type { SettlementFacet, SettlementResult } from './settlement.js';
export { wrapBetterSqlite3Database } from './sqlite-shim.js';
export type { SqlDatabase, SqlStatement } from './sql-db.js';
export type { Zone } from '@vattr/toybox/src/types.js';
export type { SlotRow } from './gnucash-schema.js';
export { SLOT_TYPE_GUID, SLOT_TYPE_STRING } from './gnucash-schema.js';

/**
 * Initialize an empty sqlite database with the GnuCash schema.
 * @see ./sql/gc_empty.sql
 */
export const initGnuCashSchema = (
  db: SqlDatabase,
  options: { allowTransactionStatements?: boolean } = {},
): void => {
  const { allowTransactionStatements = true } = options;
  if (allowTransactionStatements) {
    db.exec(gcEmptySql);
    return;
  }
  const sanitized = gcEmptySql
    .replace(/\bBEGIN TRANSACTION;\s*/gi, '')
    .replace(/\bCOMMIT;\s*/gi, '');
  db.exec(sanitized);
};

export const ensureGnuCashSchema = (
  db: SqlDatabase,
  options: { allowTransactionStatements?: boolean } = {},
): void => {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('accounts');
  if (!row) {
    initGnuCashSchema(db, options);
  }
};

/** A payment's hold: the transaction and split that hold its value until it's deposited or burned. */
type HoldRecord = {
  amount: bigint;
  sourceAccountGuid: Guid;
  txGuid: Guid;
  holdingSplitGuid: Guid;
  checkNumber: string;
};

/**
 * The issuer kit of one commodity, its kinds defined in the commodity's own
 * sub-zone of `zone`.
 */
const makeIssuerKitForCommodity = ({
  db,
  commodityGuid,
  makeGuid,
  nowMs,
  zone: parentZone,
  unsealer, // <<< ADDED
}: {
  db: SqlDatabase;
  commodityGuid: Guid;
  makeGuid: () => Guid;
  nowMs: () => number;
  zone: Zone;
  unsealer: Unsealer; // <<< ADDED
}): IssuerKitForCommodity & Pick<IssuerKitWithPurseGuids, 'purses'> => {
  const zone = parentZone.subZone(commodityGuid);
  // TODO: consider validation of DB capability and schema.
  const displayInfo = harden({ assetKind: 'nat' as const });
  const amountShape = harden({});
  const holds: MapStore<object, HoldRecord> = zone.mapStore('holds');
  const assertAmount = (amount: AmountLike) => {
    if (amount.brand !== brand) {
      throw new Error('amount brand mismatch');
    }
    return Nat(amount.value);
  };
  const makeAmount = (value: bigint) => harden({ brand, value: Nat(value) });
  const getAllegedName = () => getCommodityAllegedName(db, commodityGuid);
  const commodityLabel = getAllegedName();
  const balanceAccountGuid = makeDeterministicGuid(
    `ertp-books-balance:${commodityGuid}`,
  );
  /** Whether `payment`'s hold is still in the holding account, not yet deposited or burned. */
  const isLive = (payment: object) => {
    if (!holds.has(payment)) return false;
    const { holdingSplitGuid } = holds.get(payment);
    const row = db
      .prepare<[string, string], { reconcile_state: string }>(
        'SELECT reconcile_state FROM splits WHERE guid = ? AND account_guid = ?',
      )
      .get(holdingSplitGuid, balanceAccountGuid);
    return row?.reconcile_state === 'n';
  };
  const makePaymentObject = zone.exoClass(
    `${commodityLabel} Payment`,
    undefined,
    () => ({}),
    {},
  );
  const makePayment = (
    amount: AmountLike,
    sourceAccountGuid: Guid,
    txGuid: Guid,
    holdingSplitGuid: Guid,
    checkNumber: string,
  ) => {
    const amountValue = assertAmount(amount);
    const payment = makePaymentObject();
    holds.init(
      payment,
      harden({
        amount: amountValue,
        sourceAccountGuid,
        txGuid,
        holdingSplitGuid,
        checkNumber,
      }),
    );
    return payment;
  };
  ensureAccountRow({
    db,
    accountGuid: balanceAccountGuid,
    name: `${commodityLabel} Mint Holding`,
    commodityGuid,
    // GnuCash requires non-currency commodities to live under STOCK/MUTUAL/related accounts.
    accountType: 'STOCK',
  });
  const transferRecorder = makeTransferRecorder({
    db,
    commodityGuid,
    holdingAccountGuid: balanceAccountGuid,
    makeGuid,
    nowMs,
  });
  const consumePayment = (payment: object, toAccountGuid: Guid) => {
    if (!isLive(payment)) throw new Error('payment not live');
    const { amount, txGuid, holdingSplitGuid } = holds.get(payment);
    transferRecorder.finalizeHold({ txGuid, holdingSplitGuid, toAccountGuid });
    return amount;
  };
  const { makeNewPurse, openPurse, purseGuids, depositFacetGuids } =
    makePurseFactory({
      zone,
      db,
      commodityGuid,
      commodityLabel,
      makeAmount,
      makePayment,
      consumePayment,
      transferRecorder,
      getBrand: () => brand,
    });
  const brand = zone.exo(`${commodityLabel} Brand`, undefined, {
    isMyIssuer: async (allegedIssuer: object) => allegedIssuer === issuer,
    getAllegedName: () => getAllegedName(),
    getDisplayInfo: () => displayInfo,
    getAmountShape: () => amountShape,
  });
  const issuer = zone.exo(`${commodityLabel} Issuer`, undefined, {
    getBrand: () => brand,
    getAllegedName: () => getAllegedName(),
    getAssetKind: () => 'nat' as const,
    getDisplayInfo: () => displayInfo,
    makeEmptyPurse: () => {
      const accountGuid = makeGuid();
      return makeNewPurse(accountGuid, accountGuid);
    },
    isLive: async (payment: object) => isLive(payment),
    getAmountOf: async (payment: object) =>
      makeAmount(isLive(payment) ? holds.get(payment).amount : 0n),
    burn: async (payment: object) =>
      makeAmount(consumePayment(payment, balanceAccountGuid)),
  });
  const mintRecoveryGuid = makeDeterministicGuid(
    `ertp-books:recovery:${commodityGuid}`,
  );
  ensureAccountRow({
    db,
    accountGuid: mintRecoveryGuid,
    name: `${commodityLabel} Mint Recovery`,
    commodityGuid,
    accountType: 'STOCK',
  });
  const mint = zone.exo(`${commodityLabel} Mint`, undefined, {
    getIssuer: () => issuer,
    mintPayment: (amount: AmountLike) => {
      const amountValue = assertAmount(amount);
      const { txGuid, holdingSplitGuid, checkNumber } =
        transferRecorder.createHold({
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
  const mintRecoveryPurse = openPurse(mintRecoveryGuid);
  const kit = harden({
    brand,
    issuer,
    mint,
    mintRecoveryPurse,
    displayInfo,
  }) as unknown as NatIssuerKit;
  const mintInfo = zone.exo(`${commodityLabel} MintInfoAccess`, undefined, {
    getMintInfo: () =>
      harden({
        holdingAccountGuid: balanceAccountGuid,
        recoveryPurseGuid: mintRecoveryGuid,
      }),
  });
  const payments = zone.exo(`${commodityLabel} PaymentAccess`, undefined, {
    getCheckNumber: (payment: object) => {
      if (!holds.has(payment)) throw new Error('unknown payment');
      return holds.get(payment).checkNumber;
    },
    openPayment: (checkNumber: string) => {
      const rows = db
        .prepare<[string], { guid: string }>(
          'SELECT guid FROM transactions WHERE num = ?',
        )
        .all(checkNumber);
      if (rows.length !== 1) {
        throw new Error('payment check number not unique');
      }
      const txGuid = rows[0]?.guid as Guid | undefined;
      if (!txGuid) {
        throw new Error('payment not found');
      }
      const holdingSplit = db
        .prepare<
          [string, string],
          {
            guid: string;
            account_guid: string;
            quantity_num: string;
            reconcile_state: string;
          }
        >(
          `
          SELECT guid, account_guid, quantity_num, reconcile_state
          FROM splits
          WHERE tx_guid = ? AND account_guid = ?
        `,
        )
        .get(txGuid, balanceAccountGuid);
      if (!holdingSplit) {
        throw new Error('payment not live');
      }
      if (holdingSplit.reconcile_state !== 'n') {
        throw new Error('payment not live');
      }
      const sourceSplit = db
        .prepare<[string, string], { account_guid: string }>(
          `
          SELECT account_guid
          FROM splits
          WHERE tx_guid = ? AND account_guid != ?
        `,
        )
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
  const accounts = zone.exo(`${commodityLabel} AccountAccess`, undefined, {
    makeAccountPurse: (accountGuid: Guid) => {
      if (accountGuid === balanceAccountGuid) {
        throw new Error('holding account is not externally accessible');
      }
      return makeNewPurse(accountGuid, accountGuid);
    },
    openAccountPurse: (accountGuid: Guid) => {
      if (accountGuid === balanceAccountGuid) {
        throw new Error('holding account is not externally accessible');
      }
      return openPurse(accountGuid);
    },
  });
  // only createIssuerKit hands it out, but every incarnation defines it
  const purses = zone.exo(`${commodityLabel} PurseGuids`, undefined, {
    getGuid: (purse: object) => {
      if (!purseGuids.has(purse)) throw new Error('unknown purse');
      return purseGuids.get(purse);
    },
    getGuidFromSealed: (sealedPurse: unknown) => {
      const purse = unsealer.unseal(sealedPurse);
      if (!purseGuids.has(purse)) throw new Error('unknown sealed purse');
      return purseGuids.get(purse);
    },
  });
  return harden({
    kit,
    accounts,
    purseGuids: purseGuids.readOnly(),
    depositFacetGuids: depositFacetGuids.readOnly(),
    purses,
    payments,
    mintInfo,
  });
};

/**
 * Create a new GnuCash commodity entry and return an ERTP kit bound to it.
 *
 * ## Facet Separation (POLA)
 *
 * The returned kit provides separate facets rather than expanding Issuer/Purse interfaces:
 *
 * - `issuer`, `brand`, `mint` - Standard ERTP interfaces (portable, no DB coupling)
 * - `purses.getGuid(purse)` - Maps purse → account GUID (requires DB knowledge)
 * - `purses.getGuidFromSealed(token)` - Unseal + map (for escrow identification)
 * - `sealer` - Create inert tokens from purses (for secure sharing)
 * - `payments` - Reify payments by check number (DB-specific recovery)
 *
 * This separation keeps ERTP interfaces clean and portable. DB-specific operations
 * live in separate facets that can be withheld from code that doesn't need them.
 * A caller with only `issuer` cannot learn account GUIDs or reify payments.
 */
export const createIssuerKit = (
  config: CreateIssuerConfig,
): IssuerKitWithPurseGuids => {
  const { db, commodity, makeGuid, nowMs } = config;
  const { zone } = config;
  // TODO: consider validation of DB capability and schema.
  const commodityGuid = makeGuid();
  createCommodityRow({ db, guid: commodityGuid, commodity });
  const { sealer, unsealer } = makeSealerUnsealerPair();
  const { kit, purses, payments, mintInfo } = makeIssuerKitForCommodity({
    db,
    commodityGuid,
    makeGuid,
    nowMs,
    zone,
    unsealer, // <<< ADDED
  });
  return harden({
    ...kit,
    commodityGuid,
    purses,
    payments,
    mintInfo,
    sealer, // <<< ADDED
  }) as IssuerKitWithPurseGuids;
};

/**
 * Open an existing commodity by GUID and return the kit plus account access.
 *
 * Like `createIssuerKit`, returns separate facets for POLA. Unlike `createIssuerKit`,
 * this does not return a `sealer` since opening an existing commodity does not grant
 * the authority to create new sealed tokens for its purses.
 *
 * @see createIssuerKit for facet separation rationale
 */
export const openIssuerKit = (
  config: OpenIssuerConfig,
): IssuerKitForCommodity => {
  const { db, commodityGuid, makeGuid, nowMs, zone } = config;
  // TODO: consider validation of DB capability and schema.
  // TODO: verify commodity record matches expected issuer/brand metadata.
  // TODO: add a commodity-vs-currency option (namespace, fraction defaults, and naming rules).
  const { unsealer } = makeSealerUnsealerPair();
  const { purses: _purses, ...opened } = makeIssuerKitForCommodity({
    db,
    commodityGuid,
    makeGuid,
    nowMs,
    zone,
    unsealer,
  });
  return harden(opened);
};
