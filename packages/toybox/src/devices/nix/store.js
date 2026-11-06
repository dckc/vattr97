/** @file nixStores: bundleCaps for nix store paths. */
import { M } from '@endo/patterns';
import { kzone } from '../../kernel/objects.js';
import { bundleFiles, makeTreeReader } from '../../kernel/tree.js';

/**
 * @import { Device, KernelPowers } from '../../kernel/types.js';
 * @import { makeBundles } from '../../kernel/bundles.js';
 */

/** A store path: a nix base-32 hash, then a name. */
const STORE_PATH =
  /^\/nix\/store\/([0-9a-df-np-sv-z]{32}-[A-Za-z0-9+\-._?=]+)$/;

/**
 * nixStores: `getBundleCap(path)` reads a store path through config.capnp's
 * read-only `nix-store` service, so the same contents give the same
 * bundleCap ({@link bundleFiles}). A `worker.json` may also give a
 * compatibility date and flags. Symlinks, and anything not in the store,
 * are refused.
 *
 * @param {KernelPowers} powers
 * @param {object} io
 * @param {{ fetch: (url: string) => Promise<Response> }} io.store config.capnp's `nix-store` service
 * @param {ReturnType<typeof makeBundles>} io.bundles
 * @returns {Device}
 */
export const makeNixStores = (
  { next, kernelObject, standIn },
  { store, bundles },
) => {
  const readStore = makeTreeReader(
    segments =>
      store.fetch(
        `http://nix-store/${segments.map(encodeURIComponent).join('/')}`,
      ),
    segments => `/nix/store/${segments.join('/')}`,
    'the nix store',
  );

  return harden({
    kinds: {
      nixStore: kzone.exoClass(
        'NixStore',
        M.interface('NixStore', {
          getBundleCap: M.call(M.string()).returns(M.promise()),
        }),
        {
          /** @param {string} path */
          async getBundleCap(path) {
            const [, name] = path.match(STORE_PATH) ?? [];
            if (!name) throw Error('not a store path');
            return standIn(
              await bundles.installFiles(
                bundleFiles(path, await readStore([name])),
              ),
            );
          },
        },
      ),
    },
    /** A nixStore: whoever holds it can make a bundleCap for any file in the nix store. */
    make: () => kernelObject(`nixStore:${next('nixStore')}`),
  });
};
