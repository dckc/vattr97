/** Makes durable map stores for whoever asks; the asker holds the store, and can hand out its `readOnly()` facet. */
/** @import { BuildRootObject } from '../types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ Far, zone }) =>
  Far('storeMaker', {
    /** @param {string} label names the store in error messages */
    makeMapStore: label => zone.detached().mapStore(label),
  });
