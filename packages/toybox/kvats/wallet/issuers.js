/**
 * Issuer kits, after ERTP's, in miniature: `makeIssuerKit(name)` answers a
 * mint, an issuer, and a brand. A purse's deposit facet can be given to
 * whoever should be able to pay into it, and only that. Amounts are whole
 * numbers of units.
 */
/** @import { BuildRootObject, MapStore } from '../../types.js' */

/** @param {unknown} value */
const mustBeAmount = value => {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 0)
    throw Error(`not a whole number of units: ${value}`);
  return /** @type {number} */ (value);
};

/** @type {BuildRootObject} */
export const buildRootObject = ({ Far, zone }) => {
  /** @type {MapStore<object, { brand: object, value: number }>} each live payment: its brand and value */
  const ledger = zone.mapStore('payments');

  /**
   * The live payment `payment` of `brand`: its value, now spent, unless
   * `check` refuses it first.
   *
   * @param {object} brand
   * @param {any} payment
   * @param {(value: number) => void} check
   */
  const spend = (brand, payment, check) => {
    let entry;
    try {
      entry = ledger.get(payment);
    } catch {
      throw Error('not a live payment');
    }
    if (entry.brand !== brand) throw Error('a payment of another brand');
    check(entry.value);
    ledger.delete(payment);
    return entry.value;
  };

  const makeBrand = zone.exoClass(
    'Brand',
    undefined,
    (/** @type {string} */ name) => ({ name }),
    {
      getAllegedName() {
        return this.state.name;
      },
    },
  );
  const makePayment = zone.exoClass(
    'Payment',
    undefined,
    (/** @type {object} */ brand) => ({ brand }),
    {
      getAllegedBrand() {
        return this.state.brand;
      },
    },
  );
  /** @param {object} brand @param {number} value */
  const pay = (brand, value) => {
    const payment = makePayment(brand);
    ledger.init(payment, harden({ brand, value }));
    return payment;
  };
  const makePurse = zone.exoClassKit(
    'Purse',
    undefined,
    (/** @type {object} */ brand) => ({ brand, balance: 0 }),
    {
      purse: {
        getBalance() {
          return this.state.balance;
        },
        /** @param {object} payment */
        deposit(payment) {
          const { balance } = this.state;
          const value = spend(this.state.brand, payment, v =>
            mustBeAmount(balance + v),
          );
          this.state.balance += value;
          return value;
        },
        /** @param {number} value */
        withdraw(value) {
          mustBeAmount(value);
          if (value > this.state.balance) throw Error('not that much here');
          this.state.balance -= value;
          return pay(this.state.brand, value);
        },
        getDepositFacet() {
          return this.facets.depositFacet;
        },
      },
      depositFacet: {
        /** @param {object} payment */
        receive(payment) {
          return this.facets.purse.deposit(payment);
        },
      },
    },
  );
  const makeIssuer = zone.exoClass(
    'Issuer',
    undefined,
    (/** @type {object} */ brand) => ({ brand }),
    {
      getBrand() {
        return this.state.brand;
      },
      makeEmptyPurse() {
        return makePurse(this.state.brand).purse;
      },
      /** @param {object} payment */
      isLive(payment) {
        try {
          return ledger.get(payment).brand === this.state.brand;
        } catch {
          return false;
        }
      },
    },
  );
  const makeMint = zone.exoClass(
    'Mint',
    undefined,
    (/** @type {object} */ brand, /** @type {object} */ issuer) => ({
      brand,
      issuer,
    }),
    {
      getIssuer() {
        return this.state.issuer;
      },
      /** @param {number} value */
      mintPayment(value) {
        return pay(this.state.brand, mustBeAmount(value));
      },
    },
  );

  return Far('issuers', {
    /** @param {string} name the brand's alleged name */
    makeIssuerKit(name) {
      const brand = makeBrand(name);
      const issuer = makeIssuer(brand);
      return harden({ mint: makeMint(brand, issuer), issuer, brand });
    },
  });
};
