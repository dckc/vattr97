/** @file Installers: bundleCaps for modules a vat has in hand. */
import { M } from '@endo/patterns';
import { kzone } from '../kernel/objects.js';
import { bundleOf } from '../kernel/tree.js';

/**
 * @import { Device, KernelPowers } from '../kernel/types.js';
 * @import { makeBundles } from '../kernel/bundles.js';
 */

const { entries, fromEntries, keys } = Object;

/** A segment of a module's path, as a name in the boot directory is: no `..`, no dotfile. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Installers: `install(modules)` keeps `modules`, their source by path, as
 * a bundle, and answers its bundleCap, the same for the same modules. A
 * `worker.json` among them names the main module, and perhaps a
 * compatibility date and flags, as in a directory in the boot directory or
 * the nix store; without one, the main module is `main.js`. Each path is
 * relative, so no module lands outside the bundle.
 *
 * A bundleCap runs nothing by itself: making a vat of it takes a vatAdmin.
 * So a vat that holds an installer, and no vatAdmin, can store code but
 * not run it.
 *
 * @param {KernelPowers} powers
 * @param {object} io
 * @param {ReturnType<typeof makeBundles>} io.bundles
 * @returns {Device}
 */
export const makeInstallers = ({ next, kernelObject, standIn }, { bundles }) =>
  harden({
    kinds: {
      installer: kzone.exoClass(
        'Installer',
        M.interface('Installer', {
          install: M.call(M.recordOf(M.string(), M.string())).returns(
            M.promise(),
          ),
        }),
        {
          /** @param {Record<string, string>} modules each module's source, by its path in the bundle */
          async install(modules) {
            for (const path of keys(modules))
              if (!path.split('/').every(segment => SEGMENT.test(segment)))
                throw Error(
                  `install: not a path within a bundle: ${JSON.stringify(path)}`,
                );
            const encoder = new TextEncoder();
            const files = fromEntries(
              entries(modules).map(([path, source]) => [
                path,
                encoder.encode(source),
              ]),
            );
            return standIn(
              await bundles.installFiles(bundleOf('install', files)),
            );
          },
        },
      ),
    },
    /** An installer: whoever holds it can make a bundleCap for any modules. */
    make: () => kernelObject(`installer:${next('installer')}`),
  });
