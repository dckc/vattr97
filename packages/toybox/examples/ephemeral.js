/** Hands out an object that isn't durable: it goes when the vat restarts. */
/** @import { BuildRootObject } from '../src/types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ Far }) => {
  let n = 0;
  const ticker = Far('ticker', { tick: () => (n += 1) });
  return Far('ephemeralRoot', { getTicker: () => ticker });
};
