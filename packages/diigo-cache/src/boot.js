/**
 * diigo-cache's boot vat, after toybox's wallet boot: on each start of the
 * kernel it makes the vats from the boot directory, or upgrades each whose
 * code changed, and introduces them.
 *
 * Who holds what:
 * - boot: everything the kernel gives a boot vat; it hands on only what's below
 * - webApp (toybox examples/webapp.js): the fetch device
 * - storeMaker (toybox examples/store-maker.js): keeps the session store
 * - sessionKeeper (toybox examples/session-keeper.js): entropy, and the
 *   session store's write facet; the diigo site's door
 * - cache: one WebApp, for `load_user_items`, sending the store's `cookie`
 *   as a header
 * - gateway: the app socket's ingress, entropy for the owner's key, the
 *   cache, its public viewer, the diigo site's SessionSite, and the
 *   keeper's door; no network
 */
/** @import { BuildRootObject, MapStore, Remote } from '../../toybox/src/types.js' */

/** Where the cache reads bookmarks: diigo's own web app's API, as its pages call it. */
export const ITEMS = 'https://www.diigo.com/interact_api/load_user_items';

/** What diigo's web app sends with each call; the cookie comes from the session store. */
export const HEADERS = harden({
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0',
  'x-requested-with': 'XMLHttpRequest',
});

/**
 * The diigo session, as the extension reads it: the site, and its
 * session cookies. TODO: confirm the names in a logged-in browser's
 * devtools (Application, Cookies, www.diigo.com); a changed list closes
 * the door, so the owner page offers a new proposal.
 */
export const DIIGO = harden({
  site: 'https://www.diigo.com/',
  cookies: ['diigoandlogincookie', '_smasher_session'],
  label: 'diigo',
});

/**
 * @typedef {object} Params
 * @property {Remote} vatAdmin
 * @property {Remote} bundles the boot directory's
 * @property {Remote} entropy for the keeper's and gateway's secrets
 * @property {Remote} ingress the app socket's
 * @property {Remote} fetch the public internet, for the webApp vat alone
 */

/** @type {BuildRootObject<Params>} */
export const buildRootObject = (
  { E, Far, zone },
  { vatAdmin, bundles, entropy, ingress, fetch },
) => {
  /** @type {MapStore<string, { root: Remote, adminNode: Remote, bundle: Remote }>} each vat made, by role */
  const vats = zone.mapStore('vats');
  /** @type {MapStore<string, Remote>} the session store, and the WebApp over it */
  const kept = zone.mapStore('kept');

  /**
   * The root of the vat `role`, made from `name` in the boot directory if
   * there's none yet, or upgraded to it if its code there changed.
   *
   * @param {string} role
   * @param {string} name
   * @param {object} params for a new vat
   */
  const ensure = async (role, name, params) => {
    const bundle = await E(bundles).getBundleCap(name);
    if (!vats.has(role)) {
      const { root, adminNode } = await E(vatAdmin).createVat(bundle, params);
      vats.init(role, harden({ root, adminNode, bundle }));
      return root;
    }
    const was = vats.get(role);
    if (was.bundle !== bundle) {
      await E(was.adminNode).upgrade(bundle);
      vats.set(role, harden({ ...was, bundle }));
    }
    return was.root;
  };

  /** @param {string} key @param {() => Promise<Remote>} make */
  const once = async (key, make) => {
    if (!kept.has(key)) kept.init(key, await make());
    return kept.get(key);
  };

  return Far('diigoCacheBoot', {
    /** On each start of the kernel: make the vats, or upgrade them. */
    async start() {
      const webApps = await ensure('webApp', 'webapp.js', { egress: fetch });
      const stores = await ensure('storeMaker', 'store-maker.js', {});
      const store = await once('store', () =>
        E(stores).makeMapStore('diigo-session'),
      );
      const source = await once('source', async () =>
        E(E(webApps).makeWebApp(ITEMS, HEADERS)).withHeaderMap(
          await E(store).readOnly(),
        ),
      );
      const cache = await ensure('cache', 'cache', { source });
      const keeper = await ensure('sessionKeeper', 'session-keeper.js', {
        entropy,
      });
      const site = await E(keeper).site('diigo', DIIGO, {
        store,
        layout: { cookie: [...DIIGO.cookies] },
        after: await E(cache).onSession(),
      });
      await ensure('gateway', 'gateway', {
        ingress,
        entropy,
        cache,
        viewer: await E(cache).viewer(),
        site,
        door: await E(keeper).door(),
      });
    },
    /** The owner page's link fragment, for the operator to open. */
    ownerLink: () => E(vats.get('gateway').root).ownerLink(),
  });
};
