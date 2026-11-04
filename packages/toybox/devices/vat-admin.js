/** @file vatAdmins and admin nodes, after SwingSet's. */
import { M } from '@endo/patterns';
import { kernelObjects } from './objects.js';

/**
 * @import { KernelPowers, Kref, VatId } from '../types.js';
 * @import { makeBundles } from './bundles.js';
 */

/**
 * The vat lifecycle, as the kernel runs it.
 *
 * @typedef {object} Vats
 * @property {(hash: string, params: object) => Promise<{ vat: VatId, root: Kref }>} start a new vat on the bundle `hash`; `root` is a kref
 * @property {(vat: VatId, hash: string) => Promise<void>} upgrade
 * @property {(vat: VatId) => void} restart
 */

const BundleCap = M.remotable('BundleCap');

/**
 * vatAdmins and admin nodes, after SwingSet's. A vatAdmin's
 * `createVat(bundleCap, params)` starts a vat on an installed bundle,
 * references in `params` included, and answers `{ root, adminNode }`. An
 * admin node's `upgrade(bundleCap)` runs its vat on another bundle, keeping
 * its durable objects and params; `restart()` stops it, as an eviction
 * would, and the next message starts it again. There are no vat ids to
 * hold.
 *
 * @param {KernelPowers} powers
 * @param {object} io
 * @param {ReturnType<typeof makeBundles>} io.bundles
 * @param {Vats} io.vats
 */
export const makeVatAdmins = (
  { next, kernelObject, standIn, krefOf },
  { bundles, vats },
) => {
  /** The admin node of `vat`. @param {VatId} vat */
  const adminNode = vat => kernelObject(`adminNode:${vat}`);
  /** The vat of the admin node whose key ends in `rest`, as {@link adminNode} made it. @param {string} rest */
  const vatOf = rest => /** @type {VatId} */ (rest);
  /** @param {object} bundleCap */
  const hashOf = bundleCap => bundles.hashOf(krefOf(bundleCap));

  return harden({
    vatAdmins: kernelObjects(
      'VatAdmin',
      M.interface('VatAdmin', {
        createVat: M.call(BundleCap).optional(M.record()).returns(M.promise()),
      }),
      {
        /** @param {object} bundleCap @param {object} [params] */
        async createVat(bundleCap, params = {}) {
          const { vat, root } = await vats.start(hashOf(bundleCap), params);
          return harden({
            root: standIn(root),
            adminNode: standIn(adminNode(vat)),
          });
        },
      },
    ),
    adminNodes: kernelObjects(
      'AdminNode',
      M.interface('AdminNode', {
        upgrade: M.call(BundleCap).returns(M.promise()),
        restart: M.call().returns(M.undefined()),
      }),
      {
        /** @param {object} bundleCap */
        async upgrade(bundleCap) {
          await vats.upgrade(vatOf(this.state.rest), hashOf(bundleCap));
        },
        restart() {
          vats.restart(vatOf(this.state.rest));
        },
      },
    ),
    adminNode,
    /** A vatAdmin: whoever holds it can create vats from installed bundles. */
    make: () => kernelObject(`vatAdmin:${next('vatAdmin')}`),
  });
};
