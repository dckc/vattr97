/**
 * A boot vat for tests: it serves the app socket, counts its starts, makes
 * a child vat from `child.js` in the boot directory, and hands out swiss
 * numbers from its entropy device. `/wake` sets a wakeup 300ms out on its
 * timer, and `/woken` says how many have come. The test rewrites
 * `VERSION` to upgrade it.
 */
/** @import { BuildRootObject, HttpRequest, MapStore, Remote, Timer } from '../../src/types.js' */

const VERSION = 'v1';

/**
 * @typedef {object} Params
 * @property {Remote} vatAdmin
 * @property {Remote} bundles the boot directory's
 * @property {Remote} entropy
 * @property {Remote} ingress the app socket's
 * @property {Remote<Timer>} timer
 */

/** @type {BuildRootObject<Params>} */
export const buildRootObject = ({ E, Far, zone }, params) => {
  const { vatAdmin, bundles, entropy, ingress, timer } = params;
  /** @type {MapStore<string, number | Remote>} the start count, the wakes, and the child's root */
  const kept = zone.mapStore('kept');
  const makeWaker = zone.exoClass('Waker', undefined, () => ({}), {
    wake() {
      kept.set('woken', /** @type {number} */ (kept.get('woken')) + 1);
    },
  });
  const waker = zone.makeOnce('waker', () => makeWaker());
  const makeHandler = zone.exoClass('Handler', undefined, () => ({}), {
    /** @param {HttpRequest} request */
    async handle({ path }) {
      if (path === '/wake')
        await E(timer).wakeAt((await E(timer).now()) + 300, waker);
      const body =
        path === '/swiss'
          ? await E(entropy).swiss()
          : path === '/woken'
            ? `${kept.has('woken') ? kept.get('woken') : 0}`
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
      if (!kept.has('woken')) kept.init('woken', 0);
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
