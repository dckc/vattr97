#!/usr/bin/env node
/**
 * @file Run a toybox whose boot vat is the wallet, keeping its state, and print the first client's link.
 */
import '../node-lockdown.js';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { E } from '@endo/far';
import workerdPackage from 'workerd';
import WebSocket from 'ws';
import { connectKernel } from '../kernel-client.js';
import { here, makeWorkerd } from '../workerd-process.js';

const HELP = `usage: scripts/wallet.js STATE_DIR [PORT]

Runs toybox (workerd, on this package's config.capnp) with the wallet
(kvats/wallet) as its boot directory and its state in STATE_DIR, made if
need be and kept across runs. The wallet is at http://127.0.0.1:PORT/
(PORT is 8788 by default); the http socket is on PORT+1, and the admin
socket is STATE_DIR/admin.sock.

Prints the link to the first client's hub: whoever opens it holds that
hub. Runs until interrupted or terminated; workerd's log goes to stderr.
`;

/**
 * @param {object} [io] what main uses; Node's, by default
 * @param {string[]} [io.args]
 * @param {(text: string) => void} [io.print]
 * @param {Promise<void>} [io.stopped] settles when asked to stop
 */
export const main = async ({
  args = process.argv.slice(2),
  print = text => void process.stdout.write(text),
  stopped = new Promise(done => {
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  }),
} = {}) => {
  const [stateArg, portArg = '8788'] = args;
  const port = Number(portArg);
  if (!stateArg || args.length > 2 || !Number.isInteger(port))
    return print(HELP);
  const { startWorkerd } = makeWorkerd({
    workerd: workerdPackage.default,
    spawn,
    rm,
    connect,
    createServer,
    sleep,
    log: chunk => void process.stderr.write(chunk),
  });
  const dir = resolve(stateArg);
  for (const sub of ['state', 'worktree'])
    await mkdir(join(dir, sub), { recursive: true });
  const sock = join(dir, 'admin.sock');
  const toybox = await startWorkerd(
    'config.capnp',
    [
      ...['-s', `app=127.0.0.1:${port}`, '-s', `http=127.0.0.1:${port + 1}`],
      ...['-s', `admin=unix:${sock}`],
      ...['-d', `state=${join(dir, 'state')}`],
      ...['-d', `git-worktree=${join(dir, 'worktree')}`],
      ...['-d', `boot=${join(here, 'kvats', 'wallet')}`],
    ],
    { port, host: '127.0.0.1' },
    [sock],
  );
  try {
    // the first request to the app socket starts the boot vat
    await fetch(`http://127.0.0.1:${port}/`);
    const kernel = await connectKernel(
      new WebSocket(`ws+unix:${sock}:/kernel/main`),
    );
    const [boot] = await kernel.vats();
    const link = await E(boot.root).ownerLink();
    kernel.close();
    print(`wallet: http://127.0.0.1:${port}/${link}\n`);
    await stopped;
  } finally {
    await toybox.stop();
  }
};

await main();
