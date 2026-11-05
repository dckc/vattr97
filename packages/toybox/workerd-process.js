/** @file Run workerd on this package's config, for tests and scripts, with the I/O they hand in. */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The package's directory. */
export const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * What running workerd takes, all supplied by the caller.
 *
 * @typedef {object} WorkerdIO
 * @property {string} workerd the platform binary, not the package's bin script: the script forks it, so a kill would orphan workerd
 * @property {typeof import('node:child_process').spawn} spawn
 * @property {(path: string, opts: { force: boolean }) => Promise<void>} rm
 * @property {typeof import('node:net').connect} connect
 * @property {typeof import('node:net').createServer} createServer
 * @property {(ms: number) => Promise<void>} sleep
 * @property {(chunk: Buffer) => void} [log] where workerd's stderr goes; kept for the error, if absent
 */

/** @param {WorkerdIO} io */
export const makeWorkerd = ({
  workerd,
  spawn,
  rm,
  connect,
  createServer,
  sleep,
  log: echo,
}) => {
  /** @returns {Promise<number>} */
  const freePort = () =>
    new Promise(resolve => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const { port } = /** @type {import('node:net').AddressInfo} */ (
          s.address()
        );
        s.close(() => resolve(port));
      });
    });

  /**
   * Resolves once something accepts connections at `opts` (a port or a socket path).
   *
   * @param {import('node:net').NetConnectOpts} opts
   * @returns {Promise<boolean>}
   */
  const accepting = opts =>
    new Promise(resolve => {
      const s = connect(opts, () => (s.end(), resolve(true)));
      s.on('error', () => resolve(false));
    });

  /**
   * Run workerd on `config` until `stop()`; resolves once `listening` accepts.
   *
   * @param {string} config
   * @param {string[]} args socket, directory, and external overrides
   * @param {import('node:net').NetConnectOpts} listening
   * @param {string[]} stale socket files a crash leaves behind; bind() would fail on them
   */
  const startWorkerd = async (config, args, listening, stale = []) => {
    for (const f of stale) await rm(f, { force: true });
    const child = spawn(
      workerd,
      ['serve', '--experimental', join(here, config), ...args],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let log = '';
    child.stderr.on('data', c => (echo ? echo(c) : (log += c)));
    const exited = new Promise(resolve => child.on('exit', resolve));
    for (let i = 0; i < 100; i++) {
      // SIGKILL: a crash is the harder durability test
      if (await accepting(listening))
        return { stop: () => (child.kill('SIGKILL'), exited) };
      await sleep(50);
    }
    child.kill('SIGKILL');
    throw new Error(`workerd did not start: ${log}`);
  };

  /**
   * Listen on a free port on 127.0.0.1; answers the port.
   *
   * @param {import('node:net').Server} server
   * @returns {Promise<number>}
   */
  const listenLocal = server =>
    new Promise(resolve =>
      server.listen(0, '127.0.0.1', () =>
        resolve(
          /** @type {import('node:net').AddressInfo} */ (server.address()).port,
        ),
      ),
    );

  return harden({ freePort, accepting, startWorkerd, listenLocal });
};
