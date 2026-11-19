/**
 * The wallet's boot vat: it makes the counters, issuers, and gateway vats
 * from the source directory, examples/, and upgrades each when its code
 * there changes. The gateway serves the app socket, with the counters and
 * issuers as what every host starts with.
 */
/**
 * @import { BuildRootObject, MapStore, Remote, SwissNum } from '../../src/types.js';
 * @import { Gateway } from './gateway/gateway.js';
 */

/**
 * @typedef {object} Params
 * @property {Remote} vatAdmin
 * @property {Remote<{ getBundleCap(path: string): Promise<Remote> }>} source the source directory's bundles, by path
 * @property {Remote<{ swiss(): SwissNum }>} entropy for the gateway's swiss numbers
 * @property {Remote} ingress the app socket's
 */

/** @typedef {{ root: Remote, adminNode: Remote, bundle: Remote }} Kept */

/** @typedef {ReturnType<typeof buildRootObject>} WalletBoot the boot vat's root */

/** @satisfies {BuildRootObject<Params>} */
export const buildRootObject = (
  { E, Far, zone },
  { vatAdmin, source, entropy, ingress },
) => {
  /** @type {MapStore<string, Kept>} each vat this one made, by role */
  const vats = zone.mapStore('vats');

  /**
   * The root of the vat `role`, made from `path` in the source directory if
   * there's none yet, or upgraded to it if its code there changed.
   *
   * @param {string} role
   * @param {string} path
   * @param {object} params for a new vat
   */
  const ensure = async (role, path, params) => {
    const bundle = await E(source).getBundleCap(path);
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

  /**
   * The gateway's root. The kernel says only that it's a vat's root; it's
   * the gateway because `start()` made it from `wallet/gateway/`.
   *
   * @returns {Remote<Gateway>}
   */
  const gateway = () => vats.get('gateway').root;

  return Far('walletBoot', {
    /** On each start of the kernel: make the vats, or upgrade them. */
    async start() {
      const counters = await ensure('counters', 'wallet/counters.js', {});
      const issuers = await ensure('issuers', 'wallet/issuers.js', {});
      await ensure('gateway', 'wallet/gateway', {
        ingress,
        entropy,
        starters: { counters, issuers },
      });
    },
    /** The first client's link fragment, for the operator to open or give away. */
    provideOwnerLink: () => E(gateway()).provideOwnerLink(),
    /** The gateway's agents, by swiss number, for a client of the admin socket that holds a link. */
    agents: () => E(gateway()).agents(),
    /** The gateway's invitations, by swiss number, for a client of the admin socket that holds one. */
    invites: () => E(gateway()).invites(),
  });
};
