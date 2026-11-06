/** @file The boot directory: bundleCaps for what config.capnp's `boot` directory holds, for the boot vat to make vats from. */
import { M } from '@endo/patterns';
import { installTree, makeTreeReader } from '../devices/nix/nix-store.js';
import { kzone } from './objects.js';

/**
 * @import { KernelPowers } from '../types.js';
 * @import { makeBundles } from './bundles.js';
 */

/** A name in the boot directory: no path, no dotfile. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The boot directory's bundles. Each name in it is a bundle, as a nix store
 * path is ({@link installTree}), so a name whose contents changed answers a
 * different bundleCap.
 *
 * The kernel starts its boot vat from `boot.js` there, and hands the boot
 * vat the directory's bundles object, whose `getBundleCap(name)` it makes
 * the other vats from.
 *
 * @param {KernelPowers} powers
 * @param {object} io
 * @param {{ fetch: (url: string) => Promise<Response> }} io.boot config.capnp's `boot` service
 * @param {ReturnType<typeof makeBundles>} io.bundles
 */
export const makeBootBundles = (
  { kernelObject, standIn },
  { boot, bundles },
) => {
  /** @param {string[]} segments */
  const bootFetch = segments =>
    boot.fetch(`http://boot/${segments.map(encodeURIComponent).join('/')}`);
  const read = makeTreeReader(
    bootFetch,
    segments => `boot/${segments.join('/')}`,
    'the boot directory',
  );
  /**
   * Keep the bundle `name`; answers its bundleCap's kref.
   *
   * @param {string} name
   */
  const install = async name => {
    if (!NAME.test(name))
      throw Error(`not a name in the boot directory: ${JSON.stringify(name)}`);
    return installTree(bundles, `boot/${name}`, await read([name]));
  };

  return harden({
    ...kzone.exoClass(
      'BootBundles',
      M.interface('BootBundles', {
        getBundleCap: M.call(M.string()).returns(M.promise()),
      }),
      {
        /** @param {string} name */
        async getBundleCap(name) {
          return standIn(await install(name));
        },
      },
    ),
    install,
    /** Whether the boot directory holds `name`. @param {string} name */
    has: async name => (await bootFetch([name])).ok,
    /** The boot directory's bundles object: whoever holds it can make a bundleCap for anything in it. */
    make: () => kernelObject('bootBundles:boot'),
  });
};
