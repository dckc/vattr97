/**
 * A boot vat for tests: it serves the app socket, counts its starts, and
 * makes a child vat from `child.js` in the boot directory. The test
 * rewrites `VERSION` to upgrade it.
 */
/** @import { BuildRootObject, MapStore, Remote } from '../../src/types.js' */

const VERSION = 'v1';

/**
 * @typedef {object} Params
 * @property {Remote} vatAdmin
 * @property {Remote} bundles the boot directory's
 * @property {Remote} ingress the app socket's
 */

/** @type {BuildRootObject<Params>} */
export const buildRootObject = ({ E, Far, zone }, params) => {
  const { vatAdmin, bundles, ingress } = params;
  /** @type {MapStore<string, any>} */
  const kept = zone.mapStore('kept');
  const makeHandler = zone.exoClass('Handler', undefined, () => ({}), {
    handle() {
      return {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: `${VERSION} started ${kept.get('starts')}`,
      };
    },
  });
  zone.makeOnce('served', () => {
    const handler = makeHandler();
    E(ingress).serve(handler);
    return handler;
  });
  return Far('testBoot', {
    async start() {
      if (!kept.has('starts')) kept.init('starts', 0);
      kept.set('starts', kept.get('starts') + 1);
      if (!kept.has('child')) {
        const { root } = await E(vatAdmin).createVat(
          await E(bundles).getBundleCap('child.js'),
        );
        kept.init('child', root);
      }
    },
    child: () => kept.get('child'),
    /** The names of the powers this vat was made with. */
    powers: () => harden(Object.keys(params).sort()),
  });
};
