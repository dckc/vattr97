/** @file A dependent's device: a vat granted a binding from the config by the boot vat. */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/** A toybox directory with test/device/ as its boot directory, and a file for the device to read. */
const makeFixture = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'toybox-device-'));
  const boot = join(dir, 'bootdir');
  const files = join(dir, 'files');
  await mkdir(boot);
  await mkdir(files);
  await writeFile(join(files, 'a.txt'), 'hello from disk');
  const source = join(here, 'test', 'device');
  const device = await readFile(join(source, 'device.js'), 'utf8');
  await writeFile(
    join(boot, 'boot.js'),
    await readFile(join(source, 'boot.js'), 'utf8'),
  );
  await writeFile(join(boot, 'device.js'), device);
  const start = () =>
    startToybox(dir, {
      boot,
      config: 'test/config-device.capnp',
      args: ['-d', `files=${files}`],
    });
  return { dir, boot, device, start };
};

/**
 * The boot vat's root, once the first request to the app socket has started it.
 *
 * @param {Awaited<ReturnType<typeof startToybox>>} box
 */
const connectBoot = async box => {
  await fetch(`http://127.0.0.1:${box.appPort}/`);
  const main = await connectKernel(
    new WebSocket(`ws+unix:${box.sock}:/kernel/main`),
  );
  const [bootVat] = await main.vats();
  return { main, boot: bootVat.root };
};

test('a device vat reads through its granted binding, across restarts and upgrades', async () => {
  const { dir, boot: bootDir, device, start } = await makeFixture();
  let box = await start();
  try {
    let { main, boot } = await connectBoot(box);
    const reader = E(boot).reader();
    assert.equal(await E(reader).read(), 'hello from disk');
    main.close();

    await box.server.stop();
    await writeFile(join(bootDir, 'device.js'), device.replace("'v1'", "'v2'"));
    box = await start();
    ({ main, boot } = await connectBoot(box));
    assert.equal(await E(E(boot).reader()).read(), 'hello from disk');
    assert.equal(await E(E(boot).device()).version(), 'v1');
    await E(boot).upgradeDevice();
    assert.equal(await E(E(boot).device()).version(), 'v2');
    assert.equal(await E(E(boot).reader()).read(), 'hello from disk');
    main.close();
  } finally {
    await box.server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('only what the boot vat grants reaches a binding', async () => {
  const { dir, start } = await makeFixture();
  const box = await start();
  try {
    const { main, boot } = await connectBoot(box);
    await assert.rejects(
      E(E(E(boot).ungranted()).reader('a.txt')).read(),
      /no endowment files/,
    );
    await assert.rejects(E(boot).ask('NIX_STORE'), /no grantable binding/);
    await assert.rejects(E(boot).grantBundles(), /not an endowment/);
    main.close();
  } finally {
    await box.server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a binding added to the config reaches a boot vat made before it', async () => {
  const { dir, boot: bootDir, start } = await makeFixture();
  let box = await startToybox(dir, { boot: bootDir });
  try {
    const refused = await fetch(`http://127.0.0.1:${box.appPort}/`);
    assert.equal(refused.status, 502);
    await box.server.stop();
    box = await start();
    const { main, boot } = await connectBoot(box);
    assert.equal(await E(E(boot).reader()).read(), 'hello from disk');
    main.close();
  } finally {
    await box.server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a vat whose binding is no longer grantable fails to start, and says why', async () => {
  const { dir, boot: bootDir, start } = await makeFixture();
  let box = await start();
  try {
    const { main } = await connectBoot(box);
    main.close();
    await box.server.stop();
    box = await startToybox(dir, { boot: bootDir });
    const again = await connectBoot(box);
    await assert.rejects(
      E(E(again.boot).reader()).read(),
      /no grantable binding FILES/,
    );
    again.main.close();
  } finally {
    await box.server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
