/**
 * A party that holds a stub of Bob's directly, and tries to hand Bob a
 * gift allegedly from Carol, but wrapped by itself: to get Bob blaming
 * Carol for what it serves.
 */
/** @import { BuildRootObject, Remote } from '../../src/types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ E, Far }) =>
  Far('forgerRoot', {
    /**
     * @param {Remote} s1 Bob's stub, for the forger's use
     * @param {Remote} whoBob @param {Remote} whoCarol
     * @param {string} verb
     */
    forge: async (s1, whoBob, whoCarol, verb) => {
      const fake = Far('FakePage', { read: () => 'fake', write: () => {} });
      const gift = await E(whoBob).seal(
        // it can't open the fill box, sealed for Carol, so it tries the fake directly
        Far('Provide', { provide: () => fake }),
      );
      return E(s1).deliver(verb, [{ gift, from: whoCarol }]);
    },
  });
