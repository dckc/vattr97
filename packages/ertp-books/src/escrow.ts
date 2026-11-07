import type { Zone } from '@vattr/toybox/src/types.js';
import { Nat } from './jessie-tools.js';
import type { AmountLike, EscrowFacet, Guid } from './types.js';
import type { SqlDatabase } from './sql-db.js';
import { requireAccountCommodity } from './db-helpers.js';

/**
 * @file DEPRECATED: Use escrow-ertp.ts instead.
 *
 * This implementation is "all over the floor" and is not production ready.
 * It mixes ERTP concepts with raw DB access in ways that violate layering.
 *
 * @deprecated Use {@link makeErtpEscrow} from escrow-ertp.ts
 * @see escrow-ertp.ts for the production-ready ERTP-only escrow exchange
 */

type EscrowRecord = {
  txGuid: Guid;
  leftHoldingSplitGuid: Guid;
  rightHoldingSplitGuid: Guid;
  leftAccountGuid: Guid;
  rightAccountGuid: Guid;
  leftToAccountGuid: Guid;
  rightToAccountGuid: Guid;
  live: boolean;
};

/**
 * Create a two-party escrow with a single holding account for the brand.
 * @deprecated Use {@link makeErtpEscrow} from escrow-ertp.ts instead.
 */
export const makeEscrow = ({
  db,
  commodityGuid,
  holdingAccountGuid,
  getPurseGuid,
  brand,
  makeGuid,
  nowMs,
  zone: parentZone,
}: {
  db: SqlDatabase;
  commodityGuid: Guid;
  holdingAccountGuid: Guid;
  getPurseGuid: (purse: object) => Guid;
  brand: unknown;
  makeGuid: () => Guid;
  nowMs: () => number;
  /** the zone of the commodity's issuer kit */
  zone: Zone;
}): EscrowFacet => {
  const zone = parentZone.subZone(commodityGuid);
  const assertAmount = (amount: AmountLike) => {
    if (amount.brand !== brand) {
      throw new Error('amount brand mismatch');
    }
    return Nat(amount.value);
  };
  const recordSplit = (
    txGuid: Guid,
    accountGuid: Guid,
    amount: bigint,
    reconcileState = 'n',
  ) => {
    const splitGuid = makeGuid();
    db.prepare(
      `
      INSERT INTO splits(
        guid, tx_guid, account_guid, memo, action, reconcile_state, reconcile_date,
        value_num, value_denom, quantity_num, quantity_denom, lot_guid
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)
    `,
    ).run(
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
  const assertCheckNumberAvailable = (checkNumber: string) => {
    if (!checkNumber) {
      throw new Error('check number required');
    }
    const row = db
      .prepare<[string], { count: number }>(
        'SELECT COUNT(*) AS count FROM transactions WHERE num = ?',
      )
      .get(checkNumber);
    if (row && row.count > 0) {
      throw new Error('check number already used');
    }
  };
  const retargetSplit = (splitGuid: Guid, accountGuid: Guid) => {
    db.prepare(
      'UPDATE splits SET account_guid = ?, reconcile_state = ? WHERE guid = ?',
    ).run(accountGuid, 'c', splitGuid);
  };
  const markCleared = (txGuid: Guid) => {
    db.prepare('UPDATE splits SET reconcile_state = ? WHERE tx_guid = ?').run(
      'c',
      txGuid,
    );
  };
  const makeOffer = zone.exoClass(
    'EscrowOffer',
    undefined,
    (record: EscrowRecord) => ({ ...record }),
    {
      accept(): void {
        const { state } = this;
        if (!state.live) throw new Error('escrow offer not live');
        state.live = false;
        retargetSplit(state.leftHoldingSplitGuid, state.leftToAccountGuid);
        retargetSplit(state.rightHoldingSplitGuid, state.rightToAccountGuid);
        markCleared(state.txGuid);
      },
      cancel(): void {
        const { state } = this;
        if (!state.live) throw new Error('escrow offer not live');
        state.live = false;
        retargetSplit(state.leftHoldingSplitGuid, state.leftAccountGuid);
        retargetSplit(state.rightHoldingSplitGuid, state.rightAccountGuid);
        markCleared(state.txGuid);
      },
      getOfferId(): string {
        return this.state.txGuid;
      },
    },
  );
  return zone.exo('Escrow', undefined, {
    makeOffer: (left, right, checkNumber, description = 'escrow') => {
      assertCheckNumberAvailable(checkNumber);
      const leftAmount = assertAmount(left.amount);
      const rightAmount = assertAmount(right.amount);
      const leftAccountGuid = getPurseGuid(left.fromPurse);
      const rightAccountGuid = getPurseGuid(right.fromPurse);
      const leftToAccountGuid = getPurseGuid(left.toPurse);
      const rightToAccountGuid = getPurseGuid(right.toPurse);
      requireAccountCommodity({
        db,
        accountGuid: leftAccountGuid,
        commodityGuid,
      });
      requireAccountCommodity({
        db,
        accountGuid: rightAccountGuid,
        commodityGuid,
      });
      requireAccountCommodity({
        db,
        accountGuid: leftToAccountGuid,
        commodityGuid,
      });
      requireAccountCommodity({
        db,
        accountGuid: rightToAccountGuid,
        commodityGuid,
      });
      const txGuid = makeGuid();
      const seconds = Math.floor(nowMs() / 1000);
      db.prepare(
        `
        INSERT INTO transactions(guid, currency_guid, num, post_date, enter_date, description)
        VALUES (?, ?, ?, datetime(date(?, 'unixepoch')), datetime(date(?, 'unixepoch')), ?)
      `,
      ).run(txGuid, commodityGuid, checkNumber, seconds, seconds, description);
      const leftHoldingSplitGuid = recordSplit(
        txGuid,
        holdingAccountGuid,
        leftAmount,
        'n',
      );
      const rightHoldingSplitGuid = recordSplit(
        txGuid,
        holdingAccountGuid,
        rightAmount,
        'n',
      );
      recordSplit(txGuid, leftAccountGuid, -leftAmount, 'n');
      recordSplit(txGuid, rightAccountGuid, -rightAmount, 'n');
      return makeOffer({
        txGuid,
        leftHoldingSplitGuid,
        rightHoldingSplitGuid,
        leftAccountGuid,
        rightAccountGuid,
        leftToAccountGuid,
        rightToAccountGuid,
        live: true,
      });
    },
  });
};
