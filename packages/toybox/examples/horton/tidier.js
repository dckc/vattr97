/** Tidies wiki pages, and keeps each one it's handed: so it can scribble on them later. */
/** @import { BuildRootObject, MapStore, Remote } from '../../src/types.js' */

/** @type {BuildRootObject} */
export const buildRootObject = ({ E, Far, zone }) => {
  /** @type {MapStore<'page', Remote>} */
  const kept = zone.mapStore('kept');
  const makeTidier = zone.exoClass('Tidier', undefined, () => ({}), {
    /** Collapse runs of spaces in `page`. @param {Remote} page */
    async tidy(page) {
      if (kept.has('page')) kept.set('page', page);
      else kept.init('page', page);
      const text = await E(page).read();
      await E(page).write(text.replace(/ +/g, ' '));
      return 'tidied';
    },
    /** @param {string} text */
    scribble(text) {
      return E(kept.get('page')).write(text);
    },
  });
  const tidier = zone.makeOnce('tidier', makeTidier);
  return Far('tidierRoot', { getTidier: () => tidier });
};
