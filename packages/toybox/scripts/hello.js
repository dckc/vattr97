#!/usr/bin/env node
/**
 * @file Start a toybox in a scratch directory and serve a hello-world vat.
 */
import '../node-lockdown.js';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import workerdPackage from 'workerd';
import WebSocket from 'ws';
import { connectKernel } from '../kernel-client.js';
import { here, makeWorkerd } from '../workerd-process.js';

const HELP = `usage: scripts/hello.js

Starts toybox (workerd, on this package's config.capnp) with its state in a
new directory under ${tmpdir()}, creates the hello vat (examples/hello.js), and
mounts it on an ingress. Prints the URL to open. Ctrl-C stops toybox and
removes the directory.
`;

/**
 * @param {object} [io] what main uses; Node's, by default
 * @param {string[]} [io.args]
 * @param {(text: string) => void} [io.print]
 * @param {Promise<void>} [io.interrupted] settles when the user asks to stop
 */
export const main = async ({
  args = process.argv.slice(2),
  print = text => void process.stdout.write(text),
  interrupted = new Promise(resolve => process.once('SIGINT', resolve)),
} = {}) => {
  if (args.length) return print(HELP);
  const { freePort, startWorkerd } = makeWorkerd({
    workerd: workerdPackage.default,
    spawn,
    rm,
    connect,
    createServer,
    sleep,
  });
  const dir = await mkdtemp(join(tmpdir(), 'toybox-hello-'));
  await mkdir(join(dir, 'state'));
  await mkdir(join(dir, 'worktree'));
  await mkdir(join(dir, 'boot'));
  const port = await freePort();
  const appPort = await freePort();
  const sock = join(dir, 'admin.sock');
  const toybox = await startWorkerd(
    'config.capnp',
    [
      ...['-s', `http=127.0.0.1:${port}`, '-s', `admin=unix:${sock}`],
      ...['-s', `app=127.0.0.1:${appPort}`],
      ...['-d', `state=${join(dir, 'state')}`],
      ...['-d', `git-worktree=${join(dir, 'worktree')}`],
      ...['-d', `boot=${join(dir, 'boot')}`],
    ],
    { port, host: '127.0.0.1' },
  );
  try {
    const kernel = await connectKernel(
      new WebSocket(`ws+unix:${sock}:/kernel/hello`),
    );
    const ingress = await kernel.makeIngress({ app: 'hello' });
    await kernel.createVat(
      await readFile(join(here, 'examples', 'hello.js'), 'utf8'),
      { ingress },
    );
    kernel.close();
    print(`open http://127.0.0.1:${port}/?app=hello\n(Ctrl-C to stop)\n`);
    await interrupted;
  } finally {
    await toybox.stop();
    await rm(dir, { recursive: true, force: true });
  }
};

await main();
