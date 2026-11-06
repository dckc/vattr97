/** @file Toyboxes for tests: workerd on this package's config, its state in a directory of the test's. */
import { join } from 'node:path';

/** @import { makeWorkerd } from '../src/workerd-process.js' */

/**
 * @param {object} io
 * @param {ReturnType<typeof makeWorkerd>['startWorkerd']} io.startWorkerd
 * @param {(path: string, opts: { recursive: boolean }) => Promise<unknown>} io.mkdir
 */
export const makeToyboxes = ({ startWorkerd, mkdir }) =>
  harden({
    /**
     * A toybox in `dir`, its state kept there across restarts, and its
     * admin socket.
     *
     * @param {string} dir
     * @param {object} [opts]
     * @param {string} [opts.config] config.capnp, or one of a test's own
     * @param {string[]} [opts.args] more of workerd's arguments, for what `config` adds
     */
    startToybox: async (dir, { config = 'config.capnp', args = [] } = {}) => {
      await mkdir(join(dir, 'state'), { recursive: true });
      const sock = join(dir, 'admin.sock');
      const server = await startWorkerd(
        config,
        [
          ...['-s', `admin=unix:${sock}`],
          ...['-d', `state=${join(dir, 'state')}`],
          ...args,
        ],
        { path: sock },
        [sock],
      );
      return { server, sock };
    },
  });
