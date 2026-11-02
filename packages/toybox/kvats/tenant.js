/** Runs a mower: starts it and pushes until told to stop, or until it refuses. */
/** @import { BuildRootObject, Remote } from '../types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ E, Far }) =>
  Far('tenantRoot', {
    /** @param {Remote} mower @param {number} pushes */
    run: async (mower, pushes) => {
      const log = [await E(mower).start()];
      for (let i = 0; i < pushes; i += 1) {
        try {
          log.push(await E(mower).push());
        } catch (e) {
          log.push(/** @type {Error} */ (e).message);
          break;
        }
      }
      return log;
    },
  });
