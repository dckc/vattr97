/** Durable counters, made on request. */
/** @import { BuildRootObject } from '../../types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ Far, zone }) => {
  const makeCounter = zone.exoClass(
    'Counter',
    undefined,
    () => ({ count: 0 }),
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
  return Far('counters', { makeCounter: () => makeCounter() });
};
