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
/**
 * @import { AdminNode, BuildRootObject, BundleCap, Bundles, Entropy, FetchDevice, Ingress, MapStore, Remote, VatAdmin } from '../../toybox/src/types.js';
 * @import { WebApp, WebAppMaker } from '../../toybox/examples/webapp.js';
 * @import { StoreMaker } from '../../toybox/examples/store-maker.js';
 * @import { SessionKeeper } from '../../toybox/examples/session-keeper.js';
 * @import { DiigoCache } from './cache/cache.js';
 * @import { DiigoGateway } from './gateway/gateway.js';
 */

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
 * @property {Remote<VatAdmin>} vatAdmin
 * @property {Remote<Bundles>} bundles the boot directory's
 * @property {Remote<Entropy>} entropy for the keeper's and gateway's secrets
 * @property {Remote<Ingress>} ingress the app socket's
 * @property {Remote<FetchDevice>} fetch the public internet, for the webApp vat alone
 */

/**
 * Each role's vat, by the code it's made from in the boot directory.
 *
 * @typedef {object} Roles
 * @property {WebAppMaker} webApp from webapp.js
 * @property {StoreMaker} storeMaker from store-maker.js
 * @property {DiigoCache} cache from cache/
 * @property {SessionKeeper} sessionKeeper from session-keeper.js
 * @property {DiigoGateway} gateway from gateway/
 */
/** @type {{ [R in keyof Roles]: string }} */
const CODE = harden({
  webApp: 'webapp.js',
  storeMaker: 'store-maker.js',
  cache: 'cache',
  sessionKeeper: 'session-keeper.js',
  gateway: 'gateway',
});

/**
 * What boot keeps of its own making: the session store, and the WebApp over it.
 *
 * @typedef {{ store: Remote<MapStore<string, unknown>>, source: Remote<WebApp> }} Kept
 */

/** @typedef {ReturnType<typeof buildRootObject>} DiigoCacheBoot the boot vat's root */

/** @satisfies {BuildRootObject<Params>} */
export const buildRootObject = (
  { E, Far, zone },
  { vatAdmin, bundles, entropy, ingress, fetch },
) => {
  /** @type {MapStore<string, { root: Remote<object>, adminNode: Remote<AdminNode>, bundle: BundleCap }>} each vat made, by role */
  const vats = zone.mapStore('vats');
  /** @type {MapStore<keyof Kept, Kept[keyof Kept]>} see {@link Kept} */
  const kept = zone.mapStore('kept');

  /**
   * The vat `role`'s root. The kernel says only that it's some vat's
   * root; it's the one {@link Roles} names because `ensure` made it from
   * that role's code.
   *
   * @template {keyof Roles} R
   * @param {R} role
   * @returns {Remote<Roles[R]>}
   */
  const rootOf = role => /** @type {Remote<Roles[R]>} */ (vats.get(role).root);

  /**
   * The root of the vat `role`, made from its code in the boot directory
   * if there's none yet, or upgraded to it if that code changed.
   *
   * @template {keyof Roles} R
   * @param {R} role
   * @param {object} params for a new vat
   */
  const ensure = async (role, params) => {
    const bundle = await E(bundles).getBundleCap(CODE[role]);
    if (!vats.has(role)) {
      const { root, adminNode } = await E(vatAdmin).createVat(bundle, params);
      vats.init(role, harden({ root, adminNode, bundle }));
      return rootOf(role);
    }
    const was = vats.get(role);
    if (was.bundle !== bundle) {
      await E(was.adminNode).upgrade(bundle);
      vats.set(role, harden({ ...was, bundle }));
    }
    return rootOf(role);
  };

  /**
   * What boot keeps as `key`, made the first time it's asked for.
   *
   * @template {keyof Kept} K
   * @param {K} key
   * @param {() => Promise<Kept[K]>} make
   * @returns {Promise<Kept[K]>}
   */
  const once = async (key, make) => {
    if (!kept.has(key)) kept.init(key, await make());
    return /** @type {Kept[K]} */ (kept.get(key));
  };

  return Far('diigoCacheBoot', {
    /** On each start of the kernel: make the vats, or upgrade them. */
    async start() {
      const webApps = await ensure('webApp', { egress: fetch });
      const stores = await ensure('storeMaker', {});
      const store = await once('store', () =>
        E(stores).makeMapStore('diigo-session'),
      );
      const source = await once('source', async () =>
        E(E(webApps).makeWebApp(ITEMS, HEADERS)).withHeaderMap(
          await E(store).readOnly(),
        ),
      );
      const cache = await ensure('cache', { source });
      const keeper = await ensure('sessionKeeper', {
        entropy,
      });
      const site = await E(keeper).site('diigo', DIIGO, {
        store,
        layout: { cookie: [...DIIGO.cookies] },
        after: await E(cache).onSession(),
      });
      await ensure('gateway', {
        ingress,
        entropy,
        cache,
        viewer: await E(cache).viewer(),
        site,
        door: await E(keeper).door(),
      });
    },
    /** The owner page's link fragment, for the operator to open. */
    provideOwnerLink: () => E(rootOf('gateway')).provideOwnerLink(),
  });
};
