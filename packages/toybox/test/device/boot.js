/**
 * A boot vat for tests: it grants the `FILES` binding to a device vat, makes
 * a sibling on the same code with no grant, and keeps a reader the device
 * handed out.
 */
/** @import { BuildRootObject, MapStore, Remote } from '../../types.js' */

/**
 * @typedef {object} Params
 * @property {Remote} vatAdmin
 * @property {Remote} bundles the boot directory's
 * @property {Remote} endowments
 */

/** @type {BuildRootObject<Params>} */
export const buildRootObject = ({ E, Far, zone }, params) => {
  const { vatAdmin, bundles, endowments } = params;
  /** @type {MapStore<string, any>} */
  const kept = zone.mapStore('kept');
  const deviceBundle = () => E(bundles).getBundleCap('device.js');
  return Far('deviceBoot', {
    async start() {
      if (kept.has('device')) return;
      const files = await E(endowments).get('FILES');
      const device = await E(vatAdmin).createVat(
        await deviceBundle(),
        {},
        { endowments: { files } },
      );
      kept.init('device', device.root);
      kept.init('adminNode', device.adminNode);
      kept.init('reader', await E(device.root).reader('a.txt'));
      const { root } = await E(vatAdmin).createVat(await deviceBundle());
      kept.init('ungranted', root);
    },
    device: () => kept.get('device'),
    reader: () => kept.get('reader'),
    ungranted: () => kept.get('ungranted'),
    async upgradeDevice() {
      await E(kept.get('adminNode')).upgrade(await deviceBundle());
    },
    /** @param {string} name */
    ask: name => E(endowments).get(name),
    /** Try to grant something that isn't an endowment. */
    async grantBundles() {
      await E(vatAdmin).createVat(
        await deviceBundle(),
        {},
        { endowments: { files: bundles } },
      );
    },
  });
};
