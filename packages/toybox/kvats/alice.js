/** Pays into the purse she was told to, durably. */
/** @import { BuildRootObject, MapStore, Remote } from '../types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ E, Far, zone }) => {
  /** @type {MapStore<string, Remote>} */
  const kept = zone.mapStore('kept');
  return Far('aliceRoot', {
    /** @param {Remote} purse */
    setPayee: purse => kept.init('payee', purse),
    /** @param {Remote} payment */
    pay: payment => E(kept.get('payee')).deposit(payment),
  });
};
