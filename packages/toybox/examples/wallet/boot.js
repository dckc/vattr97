/**
 * The wallet's boot vat: it makes the counters, issuers, and gateway vats
 * from the boot directory, and upgrades each when its code there changes.
 * The gateway serves the app socket, with the counters and issuers as
 * what every client's hub starts with.
 */
/** @import { BuildRootObject, MapStore, Remote } from '../../src/types.js' */

/**
 * @typedef {object} Params
 * @property {Remote} vatAdmin
 * @property {Remote} bundles the boot directory's
 * @property {Remote} entropy for the gateway's swiss numbers
 * @property {Remote} ingress the app socket's
 */

/** @typedef {{ root: Remote, adminNode: Remote, bundle: Remote }} Kept */

/** @type {BuildRootObject<Params>} */
export const buildRootObject = (
  { E, Far, zone },
  { vatAdmin, bundles, entropy, ingress },
) => {
  /** @type {MapStore<string, Kept>} each vat this one made, by role */
  const vats = zone.mapStore('vats');

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
    const kept = vats.get(role);
    // the same code gives the same bundleCap, so the same presence
    if (kept.bundle !== bundle) {
      await E(kept.adminNode).upgrade(bundle);
      vats.set(role, harden({ ...kept, bundle }));
    }
    return kept.root;
  };

  return Far('walletBoot', {
    /** On each start of the kernel: make the vats, or upgrade them. */
    async start() {
      const counters = await ensure('counters', 'counters.js', {});
      const issuers = await ensure('issuers', 'issuers.js', {});
      await ensure('gateway', 'gateway', {
        ingress,
        entropy,
        starters: { counters, issuers },
      });
    },
    /** The first client's link fragment, for the operator to open or give away. */
    ownerLink: () => E(vats.get('gateway').root).ownerLink(),
  });
};
