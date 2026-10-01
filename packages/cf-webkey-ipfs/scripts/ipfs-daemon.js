// @ts-check
/**
 * @file Run a Kubo node whose repo lives in this package (`.ipfs/`), on
 * ports that do not collide with a default Kubo install.
 *
 * Usage: node scripts/ipfs-daemon.js [--online]
 *
 * Without `--online` the node neither dials nor listens for peers, so blocks
 * stay on this machine.
 */
import {
  spawn as spawnAmbient,
  spawnSync as spawnSyncAmbient,
} from 'node:child_process';
import { existsSync as existsSyncAmbient } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import kubo from 'kubo';

const API = '/ip4/127.0.0.1/tcp/5781';
const GATEWAY = '/ip4/127.0.0.1/tcp/8781';
const SWARM = ['/ip4/0.0.0.0/tcp/4781', '/ip4/0.0.0.0/udp/4781/quic-v1'];

/**
 * @param {string[]} args
 * @param {object} io
 * @param {string} io.ipfs path of the Kubo binary
 * @param {string} io.packageDir
 * @param {NodeJS.ProcessEnv} io.env
 * @param {typeof spawnAmbient} io.spawn
 * @param {typeof spawnSyncAmbient} io.spawnSync
 * @param {typeof existsSyncAmbient} io.existsSync
 * @param {(code: number) => void} io.exit
 */
const main = (
  args,
  { ipfs, packageDir, env, spawn, spawnSync, existsSync, exit },
) => {
  const repo = join(packageDir, '.ipfs');
  const childEnv = { ...env, IPFS_PATH: repo };

  /** @param {string[]} ipfsArgs */
  const run = ipfsArgs => {
    const { status } = spawnSync(ipfs, ipfsArgs, {
      env: childEnv,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    if (status !== 0) {
      throw Error(`ipfs ${ipfsArgs.join(' ')} exited with ${status}`);
    }
  };

  if (!existsSync(join(repo, 'config'))) {
    run(['init', '--empty-repo']);
  }
  run(['config', 'Addresses.API', API]);
  run(['config', 'Addresses.Gateway', GATEWAY]);
  run(['config', '--json', 'Addresses.Swarm', JSON.stringify(SWARM)]);

  const online = args.includes('--online');
  const daemon = spawn(ipfs, ['daemon', ...(online ? [] : ['--offline'])], {
    env: childEnv,
    stdio: 'inherit',
  });
  daemon.on('exit', code => exit(code ?? 0));
};

main(process.argv.slice(2), {
  ipfs: kubo.path(),
  packageDir: join(dirname(fileURLToPath(import.meta.url)), '..'),
  env: process.env,
  spawn: spawnAmbient,
  spawnSync: spawnSyncAmbient,
  existsSync: existsSyncAmbient,
  exit: code => process.exit(code),
});
