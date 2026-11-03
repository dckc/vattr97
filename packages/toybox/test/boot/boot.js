/**
 * A boot vat for tests: it serves the app socket, counts its starts, makes
 * a child vat from `child.js` in the boot directory, and hands out swiss
 * numbers from its entropy device. The test rewrites `VERSION` to upgrade it.
 */
/** @import { BuildRootObject, HttpRequest, MapStore, Remote } from '../../types.js' */

const VERSION = 'v1';

/**
 * @typedef {object} Params
 * @property {Remote} vatAdmin
 * @property {Remote} bundles the boot directory's
 * @property {Remote} entropy
 * @property {Remote} ingress the app socket's
 */

/** @type {BuildRootObject<Params>} */
export const buildRootObject = (
  { E, Far, zone },
  { vatAdmin, bundles, entropy, ingress },
) => {
  /** @type {MapStore<string, any>} */
  const kept = zone.mapStore('kept');
  const makeHandler = zone.exoClass('Handler', undefined, () => ({}), {
    /** @param {HttpRequest} request */
    async handle({ path }) {
      const body =
        path === '/swiss'
          ? await E(entropy).swiss()
          : `${VERSION} started ${kept.get('starts')}`;
      return {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body,
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
  });
};
