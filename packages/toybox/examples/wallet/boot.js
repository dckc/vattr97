/**
 * The wallet's boot vat: it makes the counters, issuers, WebApps, stores,
 * and gateway vats from the source directory, examples/, and upgrades each
 * when its code there changes. The gateway serves the app socket, with the counters
 * and issuers as what every host starts with; the owner's host starts
 * with the WebApp maker, the store maker, and the JWT and rholo signer makers too. The gateway runs a
 * definition a host endows through the definer, which holds the installer
 * and the vatAdmin, so the gateway can make vats of code it's given and
 * nothing else of the kernel's.
 */
/**
 * @import { BuildRootObject, MapStore, Remote, SwissNum } from '../../src/types.js';
 * @import { Gateway } from './gateway/gateway.js';
 * @typedef {{ make(keyMap: Remote, kid: string, claims: Record<string, string | string[]>, ttl?: number): Remote }} JwtSigners
 * @typedef {{ make(keyMap: Remote, shardId: string, maxPhloLimit: number): Remote }} RholoSigners
 * @typedef {{ makeSigner(keyMap: Remote, algorithm: 'Ed25519' | 'P-256' | 'secp256k1', entry?: string): Remote }} Crypto
 */

/**
 * @typedef {object} Params
 * @property {Remote} vatAdmin
 * @property {Remote<{ getBundleCap(path: string): Promise<Remote> }>} source the source directory's bundles, by path
 * @property {Remote<{ swiss(): SwissNum }>} entropy for the gateway's swiss numbers
 * @property {Remote} ingress the app socket's
 * @property {Remote} fetch for the WebApp maker's egress
 * @property {Remote<{ install(modules: Record<string, string>): Promise<Remote> }>} installer for definitions' modules
 * @property {Remote<JwtSigners>} jwtSigners makes JWT signers of keys in the owner's stores
 * @property {Remote<RholoSigners>} rholoSigners makes rholo deploy signers of keys in the owner's stores
 * @property {Remote<Crypto>} crypto hashes, and signers of keys in the owner's stores
 * @property {Remote<{ now(): number }>} timer the clock, for the owner to hand on
 */

/** @typedef {{ root: Remote, adminNode: Remote, bundle: Remote }} Kept */

/** @typedef {ReturnType<typeof buildRootObject>} WalletBoot the boot vat's root */

/** @satisfies {BuildRootObject<Params>} */
export const buildRootObject = (
  { E, Far, M, zone },
  { vatAdmin, source, entropy, ingress, fetch, installer, jwtSigners, rholoSigners, crypto, timer },
) => {
  /** @type {MapStore<string, Kept>} each vat this one made, by role */
  const vats = zone.mapStore('vats');

  /**
   * Each definition's vat's admin node, by its root: kept, though nothing
   * here uses one yet, since a lost admin node can't be had again. Forgetting
   * a root's name doesn't terminate its vat: whoever it was sent on to
   * may still hold it.
   *
   * @type {MapStore<Remote, Remote>}
   */
  const defined = zone.mapStore('defined');

  /**
   * The definer: `run(modules, params)` makes a vat of `modules`, as an
   * installer takes them, with `params`, and answers its root. Its admin
   * node stays here, in `defined`.
   */
  const makeDefiner = zone.exoClass(
    'Definer',
    M.interface('Definer', {
      run: M.callWhen(M.recordOf(M.string(), M.string()), M.record()).returns(
        M.remotable(),
      ),
    }),
    () => ({}),
    {
      /** @param {Record<string, string>} modules @param {Record<string, Remote>} params */
      async run(modules, params) {
        const bundle = await E(installer).install(modules);
        const { root, adminNode } = await E(vatAdmin).createVat(bundle, params);
        defined.init(root, adminNode);
        return root;
      },
    },
  );
  const definer = zone.makeOnce('definer', () => makeDefiner());

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
      const webApps = await ensure('webApps', 'webapp.js', { egress: fetch });
      const stores = await ensure('stores', 'store-maker.js', {});
      await ensure('gateway', 'wallet/gateway', {
        ingress,
        entropy,
        starters: { counters, issuers },
      });
      await E(gateway()).equip({
        definer,
        ownerStarters: { webApps, stores, jwtSigners, rholoSigners, crypto, timer, entropy },
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
