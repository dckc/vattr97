/** Makes durable map stores for whoever asks; the asker holds the store, and can hand out its `readOnly()` facet. */
/** @import { BuildRootObject, MapStore } from '../src/types.js' */

/** @typedef {ReturnType<typeof buildRootObject>} StoreMaker this vat's root */

/** @satisfies {BuildRootObject} */
export const buildRootObject = ({ Far, zone }) =>
  Far('storeMaker', {
    /**
     * @param {string} label names the store in error messages
     * @returns {MapStore<string, unknown>} it keeps any passable value; its holder says which
     */
    makeMapStore: label => zone.detached().mapStore(label),
  });
