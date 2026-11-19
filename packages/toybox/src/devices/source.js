/** @file sourceTrees: bundleCaps for what config.capnp's `source` directory holds, by path. */
import { M } from '@endo/patterns';
import { kzone } from '../kernel/objects.js';
import { bundleFiles, makeTreeReader } from '../kernel/tree.js';

/**
 * @import { Device, KernelPowers } from '../kernel/types.js';
 * @import { makeBundles } from '../kernel/bundles.js';
 */

/** A path in the source directory: names joined by `/`, none a dotfile. */
const PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/**
 * sourceTrees: `getBundleCap(path)` reads `path`, such as
 * `wallet/gateway`, through config.capnp's read-only `source` service, as
 * a bundle ({@link bundleFiles}), so the same contents give the same
 * bundleCap. Unlike the boot directory's bundles, a bundle may be anywhere
 * in the tree, so boot directories can share one.
 *
 * @param {KernelPowers} powers
 * @param {object} io
 * @param {{ fetch: (url: string) => Promise<Response> }} io.source config.capnp's `source` service
 * @param {ReturnType<typeof makeBundles>} io.bundles
 * @returns {Device}
 */
export const makeSourceTrees = (
  { next, kernelObject, standIn },
  { source, bundles },
) => {
  const read = makeTreeReader(
    segments =>
      source.fetch(
        `http://source/${segments.map(encodeURIComponent).join('/')}`,
      ),
    segments => `source/${segments.join('/')}`,
    'the source directory',
  );

  return harden({
    kinds: {
      sourceTree: kzone.exoClass(
        'SourceTree',
        M.interface('SourceTree', {
          getBundleCap: M.call(M.string()).returns(M.promise()),
        }),
        {
          /** @param {string} path */
          async getBundleCap(path) {
            if (!PATH.test(path))
              throw Error(
                `not a path in the source directory: ${JSON.stringify(path)}`,
              );
            return standIn(
              await bundles.installFiles(
                bundleFiles(`source/${path}`, await read(path.split('/'))),
              ),
            );
          },
        },
      ),
    },
    /** A sourceTree: whoever holds it can make a bundleCap for anything in the source directory. */
    make: () => kernelObject(`sourceTree:${next('sourceTree')}`),
  });
};
