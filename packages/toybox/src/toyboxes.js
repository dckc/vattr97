/** @file Toyboxes for tests and scripts: workerd on this package's config, its state in a directory they hold, and the sockets it answers. */
import { connectKernel } from './kernel-client.js';

/**
 * @import { makeWorkerd } from './workerd-process.js';
 * @import { Tree } from './dir-tree.js';
 */

/**
 * @param {object} io
 * @param {ReturnType<typeof makeWorkerd>['startWorkerd']} io.startWorkerd
 * @param {() => Promise<number>} io.freePort
 * @param {Pick<Tree, 'path'>} io.pkg this package's files, where workerd's configs are
 * @param {typeof fetch} io.fetch for the toybox's http socket
 * @param {new (url: string) => import('ws').WebSocket} io.WebSocket for its admin socket
 */
export const makeToyboxes = ({
  startWorkerd,
  freePort,
  pkg,
  fetch,
  WebSocket,
}) =>
  harden({
    /**
     * A toybox in `dir`, its state kept there across restarts, and its
     * sockets: `http(path, init)` fetches from the http socket; `admin(kernel)` opens a session with a kernel, `main`
     * by default, on the admin socket.
     *
     * @param {Tree} dir
     * @param {object} [opts]
     * @param {string} [opts.config] its path in the package
     */
    startToybox: async (dir, { config = 'config.capnp' } = {}) => {
      const state = dir.sub('state');
      await state.ensureDir();
      const httpPort = await freePort();
      const sock = dir.path('admin.sock');
      const named = { state };
      const server = await startWorkerd(
        pkg.path(config),
        [
          ...['-s', `http=127.0.0.1:${httpPort}`],
          ...['-s', `admin=unix:${sock}`],
          ...Object.entries(named).flatMap(([name, d]) => [
            '-d',
            `${name}=${d.path()}`,
          ]),
        ],
        { port: httpPort, host: '127.0.0.1' },
        [sock],
      );
      return harden({
        /** The http socket's origin, for a person to open. */
        httpOrigin: `http://127.0.0.1:${httpPort}`,
        /** @param {string} path @param {RequestInit} [init] */
        http: (path, init) =>
          fetch(`http://127.0.0.1:${httpPort}${path}`, init),
        admin: (kernel = 'main') =>
          connectKernel(new WebSocket(`ws+unix:${sock}:/kernel/${kernel}`)),
        stop: () => server.stop(),
      });
    },
  });
