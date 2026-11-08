#!/usr/bin/env node
/**
 * @file Run a toybox from a boot directory, keeping its state, and print the boot vat's link.
 */
import '../src/node-lockdown.js';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { E } from '@endo/far';
import workerdPackage from 'workerd';
import WebSocket from 'ws';
import { connectKernel } from '../src/kernel-client.js';
import { makeWorkerd } from '../src/workerd-process.js';

const HELP = `usage: scripts/serve.js STATE_DIR BOOT_DIR [--checkout DIR] [--port PORT]

Runs toybox (workerd, on this package's config.capnp) with its state in
STATE_DIR, made if need be and kept across runs, and BOOT_DIR as its boot
directory: the kernel \`main\` boots from BOOT_DIR/boot.js. The app socket
is http://127.0.0.1:PORT/ (PORT is 8788 by default), the http socket is
on PORT+1, and the admin socket is STATE_DIR/admin.sock. Git trees read
from the git checkout DIR (STATE_DIR/checkout by default).

If the boot vat answers ownerLink(), prints "open: " and the app socket's
URL with that link appended: whoever opens it holds what it designates.
Runs until interrupted or terminated; workerd's log goes to stderr.
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
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: { checkout: { type: 'string' }, port: { type: 'string' } },
    });
  } catch {
    return print(HELP);
  }
  const { positionals, values } = parsed;
  const port = Number(values.port ?? '8788');
  // PORT+1 is the http socket's, so it must be a port too
  const portOk = Number.isInteger(port) && port > 0 && port < 65535;
  if (positionals.length !== 2 || !portOk) return print(HELP);
  const [dir, boot] = positionals.map(p => resolve(p));
  const checkout = resolve(values.checkout ?? join(dir, 'checkout'));
  const { startWorkerd } = makeWorkerd({
    workerd: workerdPackage.default,
    spawn,
    rm,
    connect,
    createServer,
    sleep,
    log: chunk => void process.stderr.write(chunk),
  });
  for (const sub of [join(dir, 'state'), checkout])
    await mkdir(sub, { recursive: true });
  const sock = join(dir, 'admin.sock');
  const toybox = await startWorkerd(
    'config.capnp',
    [
      ...['-s', `app=127.0.0.1:${port}`, '-s', `http=127.0.0.1:${port + 1}`],
      ...['-s', `admin=unix:${sock}`],
      ...['-d', `state=${join(dir, 'state')}`],
      ...['-d', `git-checkout=${checkout}`],
      ...['-d', `boot=${boot}`],
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
    const [bootVat] = await kernel.vats();
    const link = bootVat
      ? await E(bootVat.root)
          .ownerLink()
          .catch(() => '')
      : '';
    kernel.close();
    print(`open: http://127.0.0.1:${port}/${link}\n`);
    await stopped;
  } finally {
    await toybox.stop();
  }
};

await main();
