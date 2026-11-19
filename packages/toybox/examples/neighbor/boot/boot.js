/**
 * Lend the mower, as a boot directory: this boot vat makes the mower,
 * governor, and tenant vats from it, lends the tenant a governed mower,
 * and serves the yard on the app socket.
 */
import { lendMower, makeNeighbors } from './lend.js';
import { provideYard } from './yard.exo.js';

/** @import { BuildRootObject, MapStore, Remote } from '../../../src/types.js' */

/**
 * @typedef {object} Params
 * @property {Remote} vatAdmin
 * @property {Remote} bundles the boot directory's
 * @property {Remote} ingress the app socket's
 */

/** @typedef {{ root: Remote, adminNode: Remote, bundle: Remote }} Kept */

/** How many pushes the governor allows from where the mower starts. */
const FENCE = 3;

/** @type {BuildRootObject<Params>} */
export const buildRootObject = (
  { E, Far, zone },
  { vatAdmin, bundles, ingress },
) => {
  /** @type {MapStore<string, Kept>} each vat this one made, by role */
  const vats = zone.mapStore('vats');
  /** @type {MapStore<string, Remote>} the mower, its governed facet, and the tenant */
  const lease = zone.mapStore('lease');
  const yard = provideYard(zone, { E, lease, fence: FENCE });

  /**
   * The root of the vat `role`, made from `name` in the boot directory if
   * there's none yet, or upgraded to it if its code there changed.
   *
   * @param {string} role
   * @param {string} name
   */
  const ensure = async (role, name) => {
    const bundle = await E(bundles).getBundleCap(name);
    if (!vats.has(role)) {
      const { root, adminNode } = await E(vatAdmin).createVat(bundle, {});
      vats.init(role, harden({ root, adminNode, bundle }));
      return root;
    }
    const kept = vats.get(role);
    // the same code gives the same bundleCap, so the same presence
    if (kept.bundle !== bundle) {
      await E(kept.adminNode).upgrade(bundle);
      vats.set(role, harden({ ...kept, bundle }));
    }
    return kept.root;
  };

  return Far('lawnBoot', {
    /** On each start of the kernel: make the vats, or upgrade them; lend the mower once. */
    async start() {
      const neighbors = await makeNeighbors(ensure);
      if (!lease.has('mower')) {
        const lent = await lendMower(E, neighbors, FENCE);
        for (const [role, ref] of Object.entries(lent)) lease.init(role, ref);
      }
      await E(ingress).serve(yard);
    },
  });
};
