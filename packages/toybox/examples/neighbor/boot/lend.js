/** @file Lend the mower: the neighbor's vats, and a mower lent through a governor. */

/** @import { Powers, Remote } from '../../../src/types.js' */

/** @typedef {{ mowers: Remote, governor: Remote, tenant: Remote }} Neighbors the vats' roots */

/**
 * The neighbor's vats, each made by `makeVat` from its module in
 * examples/neighbor.
 *
 * @param {(role: keyof Neighbors, name: string) => Promise<Remote>} makeVat answers the root of the vat `role`, made from the module `name`
 * @returns {Promise<Neighbors>}
 */
export const makeNeighbors = async makeVat =>
  harden({
    mowers: await makeVat('mowers', 'mower.js'),
    governor: await makeVat('governor', 'governor.js'),
    tenant: await makeVat('tenant', 'tenant.js'),
  });

/**
 * Make a mower, and a governed facet of it that stops `fence` pushes from
 * where the mower starts: the tenant is lent only the governed one.
 *
 * @param {Powers['E']} E
 * @param {Neighbors} neighbors
 * @param {number} fence
 */
export const lendMower = async (E, { mowers, governor, tenant }, fence) => {
  const mower = await E(mowers).makeMower();
  const governed = await E(governor).govern(mower, fence);
  return harden({ mower, governed, tenant });
};
