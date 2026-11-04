/** @file Toyboxes for tests: workerd on this package's config, its state in a directory of the test's. */
import { join } from 'node:path';

/** @import { makeWorkerd } from '../workerd-process.js' */

/**
 * @param {object} io
 * @param {ReturnType<typeof makeWorkerd>['startWorkerd']} io.startWorkerd
 * @param {() => Promise<number>} io.freePort
 * @param {(path: string, opts: { recursive: boolean }) => Promise<unknown>} io.mkdir
 */
export const makeToyboxes = ({ startWorkerd, freePort, mkdir }) =>
  harden({
    /**
     * A toybox in `dir`, its state kept there across restarts: its http
     * and app ports, and its admin socket.
     *
     * @param {string} dir
     * @param {object} [opts]
     * @param {string} [opts.config] config.capnp, or test/config-local.capnp for a fetch device that reaches localhost
     * @param {string} [opts.boot] the boot directory; by default, an empty one in `dir`
     * @param {string[]} [opts.args] more of workerd's arguments, for what `config` adds
     */
    startToybox: async (
      dir,
      { config = 'config.capnp', boot = join(dir, 'boot'), args = [] } = {},
    ) => {
      for (const sub of ['state', 'worktree', 'boot'])
        await mkdir(join(dir, sub), { recursive: true });
      const port = await freePort();
      const appPort = await freePort();
      const sock = join(dir, 'admin.sock');
      const server = await startWorkerd(
        config,
        [
          ...['-s', `http=127.0.0.1:${port}`],
          ...['-s', `app=127.0.0.1:${appPort}`],
          ...['-s', `admin=unix:${sock}`],
          ...['-d', `state=${join(dir, 'state')}`],
          ...['-d', `git-worktree=${join(dir, 'worktree')}`],
          ...['-d', `boot=${boot}`],
          ...args,
        ],
        { port, host: '127.0.0.1' },
        [sock],
      );
      return { server, sock, port, appPort };
    },
  });
