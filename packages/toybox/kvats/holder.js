/** Keeps what it's given, by name, durably; bumps a kept counter. */
/** @import { BuildRootObject, Remote } from '../types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ E, Far, zone }) => {
  /** @type {import('../types.js').MapStore<string, Remote>} */
  const kept = zone.mapStore('kept');
  return Far('holderRoot', {
    /** @param {string} name @param {Remote} x */
    keep: (name, x) => kept.init(name, x),
    /** @param {string} name */
    get: name => kept.get(name),
    /** @param {string} name */
    bump: name => E(kept.get(name)).incr(),
    /** @param {string} name @param {Remote} x */
    isKept: (name, x) => kept.get(name) === x,
  });
};
