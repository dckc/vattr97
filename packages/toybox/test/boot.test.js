/** @file The kernel named `main` starts its boot vat from the boot directory, serves the app socket through it, and upgrades it when the directory changes. */
import { spawn } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { E } from '@endo/far';
import workerdPackage from 'workerd';
import WebSocket from 'ws';
import { connectKernel } from '../kernel-client.js';
import { here, makeWorkerd } from '../workerd-process.js';
import { makeToyboxes } from './toybox.js';

// this test is the edge: it holds Node's I/O, and gives each helper what it uses
const { freePort, startWorkerd } = makeWorkerd({
  workerd: workerdPackage.default,
  spawn,
  rm,
  connect,
  createServer,
  sleep,
});
const { startToybox } = makeToyboxes({ startWorkerd, freePort, mkdir });

test('the boot vat starts on the first request to the app socket, keeps its vats, and is upgraded when boot.js changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'toybox-boot-'));
  const boot = join(dir, 'bootdir');
  await mkdir(boot);
  const fixture = await readFile(join(here, 'test', 'boot', 'boot.js'), 'utf8');
  await writeFile(join(boot, 'boot.js'), fixture);
  await copyFile(join(here, 'kvats', 'counter.js'), join(boot, 'child.js'));
  let box = await startToybox(dir, { boot });
  /** @param {string} path */
  const app = path => fetch(`http://127.0.0.1:${box.appPort}${path}`);
  try {
    const first = await app('/');
    assert.equal(await first.text(), 'v1 started 1');
    assert.match(
      first.headers.get('content-security-policy') ?? '',
      /^default-src 'self';/,
    );
    const [a, b] = [
      await (await app('/swiss')).text(),
      await (await app('/swiss')).text(),
    ];
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.notEqual(a, b);

    const main = await connectKernel(
      new WebSocket(`ws+unix:${box.sock}:/kernel/main`),
    );
    const [bootVat, childVat] = await main.vats();
    assert.ok(childVat);
    const counter = await E(E(bootVat.root).child()).getCounter();
    assert.equal(await E(counter).incr(), 1);
    main.close();

    await box.server.stop();
    await writeFile(join(boot, 'boot.js'), fixture.replace("'v1'", "'v2'"));
    box = await startToybox(dir, { boot });
    assert.equal(await (await app('/')).text(), 'v2 started 2');
    const again = await connectKernel(
      new WebSocket(`ws+unix:${box.sock}:/kernel/main`),
    );
    const vats = await again.vats();
    assert.equal(vats.length, 2);
    assert.equal(await E(E(E(vats[0].root).child()).getCounter()).incr(), 2);
    again.close();
  } finally {
    await box.server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
