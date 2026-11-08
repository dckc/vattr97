/** One durable count. */
/** @import { Zone } from '../../../src/types.js' */

/** @param {Zone} zone */
export const prepareCount = zone => {
  const makeCount = zone.exoClass('Count', undefined, () => ({ n: 0 }), {
    incr() {
      this.state.n += 1;
      return this.state.n;
    },
  });
  return zone.makeOnce('count', () => makeCount());
};
