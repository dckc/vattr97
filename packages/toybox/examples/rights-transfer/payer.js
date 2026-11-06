/** Pays through the deposit facet she was given, durably; she can't withdraw. */
/** @import { BuildRootObject, MapStore, Remote } from '../../src/types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ E, Far, zone }) => {
  /** @type {MapStore<string, Remote>} */
  const kept = zone.mapStore('kept');
  return Far('payerRoot', {
    /** @param {Remote} depositFacet */
    setPayee: depositFacet => kept.init('payee', depositFacet),
    /** @param {Remote} payment */
    pay: payment => E(kept.get('payee')).receive(payment),
  });
};
