import type { MapStore, Zone } from '@vattr/toybox/src/types.js';
import {
  createAccountRow,
  ensureAccountRow,
  getAccountBalance,
  makeTransferRecorder,
  requireAccountCommodity,
} from './db-helpers.js';
import { Nat } from './jessie-tools.js';
import type { AccountPurse, AmountLike, Guid } from './types.js';
import type { SqlDatabase } from './sql-db.js';

type PurseFactoryOptions = {
  /** the commodity's own zone */
  zone: Zone;
  db: SqlDatabase;
  commodityGuid: Guid;
  commodityLabel: string;
  makeAmount: (value: bigint) => AmountLike;
  makePayment: (
    amount: AmountLike,
    sourceAccountGuid: Guid,
    txGuid: Guid,
    holdingSplitGuid: Guid,
    checkNumber: string,
  ) => object;
  /** Take a live payment's value into `toAccountGuid`; throws if it isn't live. */
  consumePayment: (payment: object, toAccountGuid: Guid) => bigint;
  /** @see makeTransferRecorder */
  transferRecorder: ReturnType<typeof makeTransferRecorder>;
  getBrand: () => unknown;
};

/**
 * Purses of one commodity, each over a GnuCash account: the account's
 * guid is all its durable state, and its balance is the account's.
 */
export const makePurseFactory = ({
  zone,
  db,
  commodityGuid,
  commodityLabel,
  makeAmount,
  makePayment,
  consumePayment,
  transferRecorder,
  getBrand,
}: PurseFactoryOptions) => {
  const purseGuids: MapStore<object, Guid> = zone.mapStore('purseGuids');
  /** each purse's deposit facet, to the purse's account */
  const depositFacetGuids: MapStore<object, Guid> =
    zone.mapStore('depositFacetGuids');

  const makePurseKit = zone.exoClassKit(
    `${commodityLabel} Purse`,
    undefined,
    (accountGuid: Guid) => ({ accountGuid }),
    {
      purse: {
        deposit(payment: object, _optAmountShape?: unknown): AmountLike {
          return makeAmount(consumePayment(payment, this.state.accountGuid));
        },
        withdraw(amount: AmountLike): object {
          const { accountGuid } = this.state;
          if (amount.brand !== getBrand()) {
            throw new Error('amount brand mismatch');
          }
          Nat(amount.value);
          const balance = getAccountBalance(db, accountGuid);
          if (amount.value > balance) throw new Error('insufficient funds');
          const { txGuid, holdingSplitGuid, checkNumber } =
            transferRecorder.createHold({
              fromAccountGuid: accountGuid,
              amount: amount.value,
            });
          return makePayment(
            amount,
            accountGuid,
            txGuid,
            holdingSplitGuid,
            checkNumber,
          );
        },
        getCurrentAmount(): AmountLike {
          return makeAmount(getAccountBalance(db, this.state.accountGuid));
        },
        getDepositFacet(): ReturnType<AccountPurse['getDepositFacet']> {
          return this.facets.depositFacet;
        },
      },
      depositFacet: {
        receive(payment: object, optAmountShape?: unknown): AmountLike {
          return this.facets.purse.deposit(payment, optAmountShape);
        },
      },
    },
  );

  const buildPurse = (accountGuid: Guid): AccountPurse => {
    const { purse, depositFacet } = makePurseKit(accountGuid);
    purseGuids.init(purse, accountGuid);
    depositFacetGuids.init(depositFacet, accountGuid);
    return purse;
  };

  const ensurePurse = (accountGuid: Guid, name: string): AccountPurse => {
    ensureAccountRow({ db, accountGuid, name, commodityGuid });
    return buildPurse(accountGuid);
  };

  const makeNewPurse = (accountGuid: Guid, name: string): AccountPurse => {
    createAccountRow({ db, accountGuid, name, commodityGuid });
    return buildPurse(accountGuid);
  };

  const openPurse = (accountGuid: Guid): AccountPurse => {
    requireAccountCommodity({ db, accountGuid, commodityGuid });
    return buildPurse(accountGuid);
  };

  return {
    ensurePurse,
    makeNewPurse,
    openPurse,
    purseGuids,
    depositFacetGuids,
  };
};
