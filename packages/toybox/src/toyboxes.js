/** @file Toyboxes for tests and scripts: workerd on this package's config, its state in a directory they hold, and the sockets it answers. */
import { connectKernel } from './kernel-client.js';

/**
 * @import { makeWorkerd } from './workerd-process.js';
 * @import { Tree } from './dir-tree.js';
 */

/**
 * @param {object} io
 * @param {ReturnType<typeof makeWorkerd>['startWorkerd']} io.startWorkerd
 * @param {Pick<Tree, 'path'>} io.pkg this package's files, where workerd's configs are
 * @param {new (url: string) => import('ws').WebSocket} io.WebSocket for its admin socket
 */
export const makeToyboxes = ({ startWorkerd, pkg, WebSocket }) =>
  harden({
    /**
     * A toybox in `dir`, its state kept there across restarts, and its
     * sockets: `admin(kernel)` opens a session with a kernel, `main`
     * by default, on the admin socket.
     *
     * @param {Tree} dir
     * @param {object} [opts]
     * @param {string} [opts.config] its path in the package
     */
    startToybox: async (dir, { config = 'config.capnp' } = {}) => {
      const state = dir.sub('state');
      await state.ensureDir();
      const sock = dir.path('admin.sock');
      const named = { state };
      const server = await startWorkerd(
        pkg.path(config),
        [
          ...['-s', `admin=unix:${sock}`],
          ...Object.entries(named).flatMap(([name, d]) => [
            '-d',
            `${name}=${d.path()}`,
          ]),
        ],
        { path: sock },
        [sock],
      );
      return harden({
        admin: (kernel = 'main') =>
          connectKernel(new WebSocket(`ws+unix:${sock}:/kernel/${kernel}`)),
        stop: () => server.stop(),
      });
    },
  });
