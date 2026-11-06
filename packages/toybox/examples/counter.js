/** A durable counter kind; the first counter is made once and kept. */
/** @import { BuildRootObject } from '../types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ Far, zone }) => {
  const makeCounter = zone.exoClass(
    'Counter',
    undefined,
    (/** @type {number} */ count = 0) => ({ count }),
    {
      incr() {
        this.state.count += 1;
        return this.state.count;
      },
      read() {
        return this.state.count;
      },
    },
  );
  const counter = zone.makeOnce('counter', () => makeCounter());
  return Far('counterRoot', {
    getCounter: () => counter,
    /** @param {number} [count] */
    makeCounter: count => makeCounter(count),
  });
};
