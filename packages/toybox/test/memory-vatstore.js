/** @file A vatstore in memory, as a facet's SQLite would be, for liveslots in one process. */

/** @import { Vatstore } from '../types.js' */

/**
 * @param {Record<string, string>} [entries] what's in it already
 * @returns {Vatstore}
 */
export const makeMemoryVatstore = (entries = {}) => {
  const m = new Map(Object.entries(entries));
  return harden({
    get: k => m.get(k),
    put: (k, v) => void m.set(k, v),
    delete: k => void m.delete(k),
    keys: prefix => [...m.keys()].filter(k => k.startsWith(prefix)).sort(),
  });
};
