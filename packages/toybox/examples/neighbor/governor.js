/** Governed mowers: a fence `limit` pushes from where the mower starts. */
/** @import { BuildRootObject, Remote } from '../../src/types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ E, Far, zone }) => {
  const makeGoverned = zone.exoClass(
    'Governed',
    undefined,
    (/** @type {Remote} */ mower, /** @type {number} */ limit) => ({
      mower,
      limit,
      left: limit,
    }),
    {
      start() {
        return E(this.state.mower).start();
      },
      push() {
        if (this.state.left === 0)
          throw Error(`fence: ${this.state.limit} cells from start`);
        this.state.left -= 1;
        return E(this.state.mower).push();
      },
    },
  );
  return Far('governorRoot', {
    /** @param {Remote} mower @param {number} limit */
    govern: (mower, limit) => makeGoverned(mower, limit),
  });
};
