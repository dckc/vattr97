import { Nat } from './jessie-tools.ts';
import type { Zone } from './jessie-tools.ts';
import {
  createAccountRow,
  ensureAccountRow,
  getAccountBalance,
  makeTransferRecorder,
  requireAccountCommodity,
} from './db-helpers.ts';
import type { AccountPurse, AmountLike, Guid } from './types.ts';
import type { DBRef } from './sql-db.ts';

type PurseFactoryOptions = {
  db: DBRef;
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
  livePayments: Set<object>;
  zone: Zone;
  paymentRecords: WeakMap<
    object,
    {
      amount: bigint;
      live: boolean;
      sourceAccountGuid: Guid;
      txGuid: Guid;
      holdingSplitGuid: Guid;
      checkNumber: string;
    }
  >;
  transferRecorder: ReturnType<typeof makeTransferRecorder>;
  getBrand: () => unknown;
};

export const makePurseFactory = ({
  db,
  commodityGuid,
  commodityLabel,
  makeAmount,
  makePayment,
  livePayments,
  paymentRecords,
  transferRecorder,
  getBrand,
  zone,
}: PurseFactoryOptions) => {
  const { exo } = zone;
  const purseGuids = new WeakMap<AccountPurse, Guid>();

  const buildPurse = (accountGuid: Guid, name: string): AccountPurse => {
    const brand = getBrand();
    const deposit = async (payment: object, _optAmountShape?: unknown) => {
      const record = paymentRecords.get(payment);
      if (!record?.live) throw new Error('payment not live');
      Nat(record.amount);
      record.live = false;
      livePayments.delete(payment);
      await transferRecorder.finalizeHold({
        txGuid: record.txGuid,
        holdingSplitGuid: record.holdingSplitGuid,
        toAccountGuid: accountGuid,
      });
      return makeAmount(record.amount);
    };
    const withdraw = async (amount: AmountLike) => {
      if (amount.brand !== brand) {
        throw new Error('amount brand mismatch');
      }
      Nat(amount.value);
      const balance = await getAccountBalance(db, accountGuid);
      if (amount.value > balance) throw new Error('insufficient funds');
      const { txGuid, holdingSplitGuid, checkNumber } =
        await transferRecorder.createHold({
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
    };
    const getCurrentAmount = async () =>
      makeAmount(await getAccountBalance(db, accountGuid));
    const depositFacet = exo(`${commodityLabel} DepositFacet`, {
      receive: (payment: object, optAmountShape?: unknown) =>
        deposit(payment, optAmountShape),
    });
    const purse = exo(`${commodityLabel} Purse`, {
      deposit,
      withdraw,
      getCurrentAmount,
      getDepositFacet: () => depositFacet,
    });
    purseGuids.set(purse, accountGuid);
    return purse;
  };

  const ensurePurse = async (
    accountGuid: Guid,
    name: string,
  ): Promise<AccountPurse> => {
    await ensureAccountRow({ db, accountGuid, name, commodityGuid });
    return buildPurse(accountGuid, name);
  };

  const makeNewPurse = async (
    accountGuid: Guid,
    name: string,
  ): Promise<AccountPurse> => {
    await createAccountRow({ db, accountGuid, name, commodityGuid });
    return buildPurse(accountGuid, name);
  };

  const openPurse = async (
    accountGuid: Guid,
    name: string,
  ): Promise<AccountPurse> => {
    await requireAccountCommodity({ db, accountGuid, commodityGuid });
    return buildPurse(accountGuid, name);
  };

  return { ensurePurse, makeNewPurse, openPurse, purseGuids };
};
