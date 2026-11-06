/**
 * A counter as a kit, after `@agoric/zone`'s exoClassKit: an `incr` facet
 * and a `read` facet that share one count. Either can be handed out alone.
 * Each facet's interface guard says what it takes and answers.
 */
/** @import { BuildRootObject } from '../types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ Far, M, zone }) => {
  const makeCounterKit = zone.exoClassKit(
    'CounterKit',
    {
      incr: M.interface('CounterKit incr', {
        incr: M.call().returns(M.number()),
      }),
      read: M.interface('CounterKit read', {
        read: M.call().returns(M.number()),
      }),
    },
    () => ({ n: 0 }),
    {
      incr: {
        incr() {
          this.state.n += 1;
          return this.facets.read.read();
        },
      },
      read: {
        read() {
          return this.state.n;
        },
      },
    },
  );
  const kit = zone.makeOnce('kit', () => makeCounterKit());
  return Far('kitRoot', {
    getIncr: () => kit.incr,
    getRead: () => kit.read,
    makeKit: () => makeCounterKit(),
  });
};
