/**
 * One issuer kit, after ERTP with natural-number amounts: a mint, an
 * issuer, purses, and single-use payments, all durable. A payment is live
 * while the ledger holds it; depositing it takes it out. Each kind's
 * interface guard checks what its methods take; the methods check amounts.
 */

/** @import { BuildRootObject, MapStore } from '../src/types.js' */

/** A whole number of units, no more than JavaScript counts exactly. @param {number} value */
const isAmount = value => Number.isSafeInteger(value) && value >= 0;

/** @type {BuildRootObject} */
export const buildRootObject = ({ Far, M, zone }) => {
  const Payment = M.remotable('Payment');
  /** @type {MapStore<object, number>} */
  const ledger = zone.mapStore('payments');
  const makePayment = zone.exoClass(
    'Payment',
    M.interface('Payment', {}),
    () => ({}),
    {},
  );
  /** @param {number} value */
  const pay = value => {
    const payment = makePayment();
    ledger.init(payment, value);
    return payment;
  };
  const makePurse = zone.exoClass(
    'Purse',
    M.interface('Purse', {
      getBalance: M.call().returns(M.number()),
      deposit: M.call(Payment).returns(M.number()),
      withdraw: M.call(M.number()).returns(Payment),
    }),
    () => ({ balance: 0 }),
    {
      getBalance() {
        return this.state.balance;
      },
      /** @param {object} payment */
      deposit(payment) {
        if (!ledger.has(payment))
          throw Error('not a live payment of this mint');
        const value = ledger.get(payment);
        ledger.delete(payment);
        this.state.balance += value;
        return value;
      },
      /** @param {number} value */
      withdraw(value) {
        if (!isAmount(value) || value > this.state.balance)
          throw Error('insufficient funds');
        this.state.balance -= value;
        return pay(value);
      },
    },
  );
  // Every incarnation defines every kind, even those it makes no new instances of.
  const makeIssuer = zone.exoClass(
    'Issuer',
    M.interface('Issuer', {
      makeEmptyPurse: M.call().returns(M.remotable('Purse')),
      isLive: M.call(Payment).returns(M.boolean()),
    }),
    () => ({}),
    {
      makeEmptyPurse: () => makePurse(),
      /** @param {object} payment */
      isLive: payment => ledger.has(payment),
    },
  );
  const makeMint = zone.exoClass(
    'Mint',
    M.interface('Mint', {
      mintPayment: M.call(M.number()).returns(Payment),
    }),
    () => ({}),
    {
      /** @param {number} value */
      mintPayment(value) {
        if (!isAmount(value) || value === 0)
          throw Error('a positive integer, please');
        return pay(value);
      },
    },
  );
  const issuer = zone.makeOnce('issuer', makeIssuer);
  const mint = zone.makeOnce('mint', makeMint);
  return Far('mintRoot', { getIssuer: () => issuer, getMint: () => mint });
};
