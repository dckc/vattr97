/** @file A dependent's device: a vat granted a binding from the config by the boot vat. */
import { spawn } from 'node:child_process';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { E } from '@endo/far';
import workerdPackage from 'workerd';
import WebSocket from 'ws';
import { makeTree } from '../src/dir-tree.js';
import { makeToyboxes } from '../src/toyboxes.js';
import { makeWorkerd } from '../src/workerd-process.js';

/**
 * Node's I/O, as these tests use it: the test is the edge, and each test
 * takes what it uses from here.
 */
const worldP = (async () => {
  const { freePort, startWorkerd } = makeWorkerd({
    workerd: workerdPackage.default,
    spawn,
    rm,
    connect,
    createServer,
    sleep,
  });
  const fs = { chmod, cp, mkdir, readFile, rm, symlink, writeFile };
  /** this package's files */
  const pkg = makeTree(fs, fileURLToPath(new URL('..', import.meta.url)));
  const { startToybox } = makeToyboxes({
    startWorkerd,
    freePort,
    pkg,
    fetch,
    WebSocket,
  });
  return {
    startToybox,
    pkg,
    /** A new directory of its own, for a test's toybox. @param {string} prefix */
    makeDir: async prefix =>
      makeTree(fs, await mkdtemp(join(tmpdir(), prefix))),
  };
})();

/** @typedef {Awaited<typeof worldP>} World */

/**
 * A toybox directory with test/device/ as its boot directory, and a file
 * for the device to read; `start()` grants the device its files, and
 * `startUngranted()` doesn't.
 *
 * @param {World} world
 * @param {import('node:test').TestContext} t
 */
const makeFixture = async ({ startToybox, pkg, makeDir }, t) => {
  const dir = await makeDir('toybox-device-');
  t.after(dir.remove);
  const boot = dir.sub('bootdir');
  await dir.writeText('files/a.txt', 'hello from disk');
  const device = await pkg.readText('test/device/device.js');
  await boot.writeText('boot.js', await pkg.readText('test/device/boot.js'));
  await boot.writeText('device.js', device);
  const start = () =>
    startToybox(dir, {
      boot,
      config: 'test/config-device.capnp',
      dirs: { files: dir.sub('files') },
    });
  const startUngranted = () => startToybox(dir, { boot });
  return { boot, device, start, startUngranted };
};

/**
 * The boot vat's root, once the first request to the app socket has
 * started it; the session closes after `t`.
 *
 * @param {Awaited<ReturnType<World['startToybox']>>} box
 * @param {import('node:test').TestContext} t
 */
const connectBoot = async (box, t) => {
  await box.app('/');
  const main = await box.admin();
  t.after(main.close);
  const [bootVat] = await main.vats();
  return bootVat.root;
};

test('a device vat reads through its granted binding, across restarts and upgrades', async t => {
  const { boot: bootDir, device, start } = await makeFixture(await worldP, t);

  await t.test('first', async t => {
    const box = await start();
    t.after(box.stop);
    const boot = await connectBoot(box, t);
    assert.equal(await E(E(boot).reader()).read(), 'hello from disk');
  });

  await t.test('after a crash, and new code for the device', async t => {
    await bootDir.writeText('device.js', device.replace("'v1'", "'v2'"));
    const box = await start();
    t.after(box.stop);
    const boot = await connectBoot(box, t);
    assert.equal(await E(E(boot).reader()).read(), 'hello from disk');
    assert.equal(await E(E(boot).device()).version(), 'v1');
    await E(boot).upgradeDevice();
    assert.equal(await E(E(boot).device()).version(), 'v2');
    assert.equal(await E(E(boot).reader()).read(), 'hello from disk');
  });
});

test('only what the boot vat grants reaches a binding', async t => {
  const { start } = await makeFixture(await worldP, t);
  const box = await start();
  t.after(box.stop);
  const boot = await connectBoot(box, t);
  await assert.rejects(
    E(E(E(boot).ungranted()).reader('a.txt')).read(),
    /no endowment files/,
  );
  await assert.rejects(E(boot).ask('NIX_STORE'), /no grantable binding/);
  await assert.rejects(E(boot).grantBundles(), /not an endowment/);
});

test('a binding added to the config reaches a boot vat made before it', async t => {
  const { start, startUngranted } = await makeFixture(await worldP, t);

  await t.test('without the binding', async t => {
    const box = await startUngranted();
    t.after(box.stop);
    assert.equal((await box.app('/')).status, 502);
  });

  await t.test('with it', async t => {
    const box = await start();
    t.after(box.stop);
    const boot = await connectBoot(box, t);
    assert.equal(await E(E(boot).reader()).read(), 'hello from disk');
  });
});

test('a vat whose binding is no longer grantable fails to start, and says why', async t => {
  const { start, startUngranted } = await makeFixture(await worldP, t);

  await t.test('with the binding', async t => {
    const box = await start();
    t.after(box.stop);
    await connectBoot(box, t);
  });

  await t.test('without it', async t => {
    const box = await startUngranted();
    t.after(box.stop);
    const boot = await connectBoot(box, t);
    await assert.rejects(
      E(E(boot).reader()).read(),
      /no grantable binding FILES/,
    );
  });
});
