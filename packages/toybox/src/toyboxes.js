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
 * @param {typeof fetch} io.fetch for the toybox's http and app sockets
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
     * sockets: `http(path, init)` and `app(path, init)` fetch from the http
     * and app sockets; `admin(kernel)` opens a session with a kernel, `main`
     * by default, on the admin socket.
     *
     * @param {Tree} dir
     * @param {object} [opts]
     * @param {string} [opts.config] its path in the package: config.capnp, or test/config-local.capnp for a fetch device that reaches localhost
     * @param {Tree} [opts.boot] the boot directory; by default, an empty one in `dir`
     * @param {Tree} [opts.checkout] the git checkout; by default, one in `dir`
     * @param {number} [opts.port] the app socket's port, and the http socket's is the next; free ones by default
     * @param {Record<string, Tree>} [opts.dirs] more of workerd's directories, by name, for what `config` adds
     */
    startToybox: async (
      dir,
      {
        config = 'config.capnp',
        boot = dir.sub('boot'),
        checkout = dir.sub('checkout'),
        port = undefined,
        dirs = {},
      } = {},
    ) => {
      const state = dir.sub('state');
      for (const d of [state, checkout, boot]) await d.ensureDir();
      const appPort = port ?? (await freePort());
      const httpPort = port === undefined ? await freePort() : port + 1;
      const sock = dir.path('admin.sock');
      const named = { state, 'git-checkout': checkout, boot, ...dirs };
      const server = await startWorkerd(
        pkg.path(config),
        [
          ...['-s', `http=127.0.0.1:${httpPort}`],
          ...['-s', `app=127.0.0.1:${appPort}`],
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
        /** The app socket's origin, for a person to open. */
        appOrigin: `http://127.0.0.1:${appPort}`,
        /** The http socket's origin, for a person to open. */
        httpOrigin: `http://127.0.0.1:${httpPort}`,
        /** @param {string} path @param {RequestInit} [init] */
        http: (path, init) =>
          fetch(`http://127.0.0.1:${httpPort}${path}`, init),
        /** @param {string} path @param {RequestInit} [init] */
        app: (path, init) => fetch(`http://127.0.0.1:${appPort}${path}`, init),
        admin: (kernel = 'main') =>
          connectKernel(new WebSocket(`ws+unix:${sock}:/kernel/${kernel}`)),
        stop: () => server.stop(),
      });
    },
  });
