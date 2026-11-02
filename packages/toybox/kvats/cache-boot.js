/**
 * Boots a bookmark cache, after SwingSet's bootstrap vat: it makes the
 * vats, from code in the nix store, and introduces them. It keeps the
 * cookie store, so setCookie rotates the cookie; the cache gets a WebApp
 * that reads it through the store's read-only facet, the ingress to serve
 * its page at, and the git tree of templates to render it with.
 */
/** @import { BuildRootObject, MapStore, Remote } from '../types.js' */

/**
 * @typedef {object} Params
 * @property {Remote} vatAdmin makes the vats
 * @property {Remote} nixStore where their code comes from
 * @property {Record<'webApp' | 'storeMaker' | 'cache', string>} paths each vat's code, by store path
 * @property {Remote} fetch the webApp vat's way out
 * @property {Remote} ingress where the cache serves its page
 * @property {Remote} templates a git tree with templates/bookmarks.html
 */

/** @type {BuildRootObject<Params>} */
export const buildRootObject = (
  { E, Far, zone },
  { vatAdmin, nixStore, paths, fetch, ingress, templates },
) => {
  /** @type {MapStore<string, Remote>} */
  const booted = zone.mapStore('booted');
  /** @param {keyof Params['paths']} role @param {object} params */
  const make = async (role, params) =>
    E(vatAdmin).createVat(await E(nixStore).getBundleCap(paths[role]), params);

  return Far('cacheBoot', {
    /**
     * @param {string} url where the bookmarks are
     * @returns the cache, and the vats' admin nodes, by role
     */
    async bootstrap(url) {
      if (booted.has('store')) throw Error('already booted');
      const webApps = await make('webApp', { egress: fetch });
      const stores = await make('storeMaker', {});
      const store = await E(stores.root).makeMapStore('session');
      booted.init('store', store);
      const source = await E(E(webApps.root).makeWebApp(url)).withHeaderMap(
        await E(store).readOnly(),
      );
      const cache = await make('cache', { source, ingress, templates });
      return harden({
        cache: cache.root,
        admins: {
          webApp: webApps.adminNode,
          storeMaker: stores.adminNode,
          cache: cache.adminNode,
        },
      });
    },
    /** @param {string} cookie the session cookie the cache sends from now on */
    async setCookie(cookie) {
      const store = booted.get('store');
      if (await E(store).has('cookie')) await E(store).set('cookie', cookie);
      else await E(store).init('cookie', cookie);
    },
  });
};
