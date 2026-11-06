/** @file vatAdmins and admin nodes, after SwingSet's. */
import { M } from '@endo/patterns';
import { kzone } from './objects.js';

/**
 * @import { KernelPowers, Kref, VatId } from '../types.js';
 * @import { makeBundles } from './bundles.js';
 * @import { Grants, makeEndowments } from './endowments.js';
 */

/**
 * The vat lifecycle, as the kernel runs it.
 *
 * @typedef {object} Vats
 * @property {(hash: string, params: object, grants: Grants) => Promise<{ vat: VatId, root: Kref }>} start a new vat on the bundle `hash`, granted `grants`; `root` is a kref
 * @property {(vat: VatId, hash: string) => Promise<void>} upgrade
 * @property {(vat: VatId) => void} restart
 */

const BundleCap = M.remotable('BundleCap');
const Endowment = M.remotable('Endowment');

/**
 * vatAdmins and admin nodes, after SwingSet's. A vatAdmin's
 * `createVat(bundleCap, params, { endowments })` starts a vat on an installed
 * bundle, references in `params` included, and answers `{ root, adminNode }`.
 * `endowments` names the bindings it's granted, each by the name the vat
 * will know it by. An admin node's `upgrade(bundleCap)` runs its vat on
 * another bundle, keeping its durable objects, params, and endowments;
 * `restart()` stops it, as an eviction would, and the next message starts it
 * again. There are no vat ids to hold.
 *
 * @param {KernelPowers} powers
 * @param {object} io
 * @param {ReturnType<typeof makeBundles>} io.bundles
 * @param {Pick<ReturnType<typeof makeEndowments>, 'grantsOf'>} io.endowments
 * @param {Vats} io.vats
 */
export const makeVatAdmins = (
  { next, kernelObject, standIn, krefOf },
  { bundles, endowments: grantable, vats },
) => {
  /** The admin node of `vat`. @param {VatId} vat */
  const adminNode = vat => kernelObject(`adminNode:${vat}`);
  /** The vat of the admin node whose key ends in `rest`, as {@link adminNode} made it. @param {string} rest */
  const vatOf = rest => /** @type {VatId} */ (rest);
  /** @param {object} bundleCap */
  const hashOf = bundleCap => bundles.hashOf(krefOf(bundleCap));

  return harden({
    vatAdmins: kzone.exoClass(
      'VatAdmin',
      M.interface('VatAdmin', {
        createVat: M.call(BundleCap)
          .optional(
            M.record(),
            M.splitRecord(
              {},
              { endowments: M.recordOf(M.string(), Endowment) },
            ),
          )
          .returns(M.promise()),
      }),
      {
        /**
         * @param {object} bundleCap
         * @param {object} [params]
         * @param {{ endowments?: Record<string, object> }} [options]
         */
        async createVat(bundleCap, params = {}, { endowments = {} } = {}) {
          const { vat, root } = await vats.start(
            hashOf(bundleCap),
            params,
            grantable.grantsOf(endowments),
          );
          return harden({
            root: standIn(root),
            adminNode: standIn(adminNode(vat)),
          });
        },
      },
    ),
    adminNodes: kzone.exoClass(
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
