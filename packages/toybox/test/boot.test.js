/** @file The kernel named `main` starts its boot vat from the boot directory, serves the app socket through it, and upgrades it when the directory changes. */
import { spawn } from 'node:child_process';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
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

test('the boot vat starts on the first request to the app socket, keeps its vats, and is upgraded when boot.js changes', async t => {
  const { startToybox, pkg, makeDir } = await worldP;
  const dir = await makeDir('toybox-boot-');
  t.after(dir.remove);
  const fixture = await pkg.readText('test/boot/boot.js');
  await dir.writeText('bootdir/boot.js', fixture);
  await pkg.copy('examples/counter.js', dir, 'bootdir/child.js');
  const boot = dir.sub('bootdir');

  await t.test('on the first request', async t => {
    const box = await startToybox(dir, { boot });
    t.after(box.stop);
    const first = await box.app('/');
    assert.equal(await first.text(), 'v1 started 1');
    assert.match(
      first.headers.get('content-security-policy') ?? '',
      /^default-src 'self';/,
    );
    const [a, b] = [
      await (await box.app('/swiss')).text(),
      await (await box.app('/swiss')).text(),
    ];
    assert.match(a, /^[A-Za-z0-9_-]{22}$/);
    assert.notEqual(a, b);

    const main = await box.admin();
    t.after(main.close);
    const [bootVat, childVat] = await main.vats();
    assert.ok(childVat);
    assert.deepEqual(await E(bootVat.root).powers(), [
      'bundles',
      'endowments',
      'entropy',
      'fetch',
      'gitTrees',
      'ingress',
      'installer',
      'lan',
      'nixStore',
      'source',
      'vatAdmin',
    ]);
    const counter = await E(E(bootVat.root).child()).getCounter();
    assert.equal(await E(counter).incr(), 1);
    await assert.rejects(
      E(bootVat.adminNode).terminate(),
      /the boot vat can't be terminated/,
    );
  });

  await t.test('after a crash, and new code in boot.js', async t => {
    await dir.writeText('bootdir/boot.js', fixture.replace("'v1'", "'v2'"));
    const box = await startToybox(dir, { boot });
    t.after(box.stop);
    assert.equal(await (await box.app('/')).text(), 'v2 started 2');
    const main = await box.admin();
    t.after(main.close);
    const vats = await main.vats();
    assert.equal(vats.length, 2);
    assert.equal(await E(E(E(vats[0].root).child()).getCounter()).incr(), 2);
  });
});

/**
 * Make the boot vat in `stateDir` as a kernel without the device `name`
 * would have: its params, as the kernel keeps them, lack it.
 *
 * @param {string} stateDir a stopped toybox's state directory
 * @param {string} name
 */
const dropBootParam = async (stateDir, name) => {
  const kernelDir = join(stateDir, 'toybox-kernel');
  // the kernel's own database; `<id>.<n>.sqlite` are its vats' facets
  const [file, ...more] = (await readdir(kernelDir)).filter(f =>
    /^[0-9a-f]{64}\.sqlite$/.test(f),
  );
  assert.ok(file && !more.length, 'one kernel');
  const db = new DatabaseSync(join(kernelDir, file));
  try {
    const { vat } = /** @type {{ vat: string }} */ (
      db.prepare('SELECT vat FROM kboot').get()
    );
    const { params } = /** @type {{ params: string }} */ (
      db.prepare('SELECT params FROM kvat WHERE vat = ?').get(vat)
    );
    const { body, slots } = JSON.parse(params);
    const { [name]: dropped, ...rest } = JSON.parse(body.slice(1));
    assert.ok(dropped, `the boot vat had ${name}`);
    db.prepare('UPDATE kvat SET params = ? WHERE vat = ?').run(
      JSON.stringify({ body: `#${JSON.stringify(rest)}`, slots }),
      vat,
    );
  } finally {
    db.close();
  }
};

test('a device the kernel gained reaches a boot vat made before it, on its next start', async t => {
  const { startToybox, pkg, makeDir } = await worldP;
  const dir = await makeDir('toybox-boot-added-');
  t.after(dir.remove);
  await dir.writeText(
    'bootdir/boot.js',
    await pkg.readText('test/boot/boot.js'),
  );
  await pkg.copy('examples/counter.js', dir, 'bootdir/child.js');
  const boot = dir.sub('bootdir');

  /** The boot vat's powers, on a start of the toybox. */
  const powers = async () => {
    const box = await startToybox(dir, { boot });
    try {
      await box.app('/');
      const main = await box.admin();
      try {
        const [bootVat] = await main.vats();
        return await E(bootVat.root).powers();
      } finally {
        main.close();
      }
    } finally {
      await box.stop();
    }
  };

  assert.ok((await powers()).includes('installer'));
  await dropBootParam(dir.path('state'), 'installer');
  assert.ok((await powers()).includes('installer'), 'given again');
});

test('a boot directory may hold its boot vat as `boot/`, a bundle of several modules', async t => {
  const { startToybox, pkg, makeDir } = await worldP;
  const dir = await makeDir('toybox-boot-dir-');
  t.after(dir.remove);
  await dir.writeText(
    'bootdir/boot/worker.json',
    JSON.stringify({ mainModule: 'boot.js' }),
  );
  await dir.writeText(
    'bootdir/boot/boot.js',
    (await pkg.readText('test/boot/boot.js')).replace(
      "const VERSION = 'v1';",
      "import { VERSION } from './version.js';",
    ),
  );
  await dir.writeText(
    'bootdir/boot/version.js',
    "export const VERSION = 'from a module beside it';\n",
  );
  await pkg.copy('examples/counter.js', dir, 'bootdir/child.js');
  const box = await startToybox(dir, { boot: dir.sub('bootdir') });
  t.after(box.stop);
  const page = await box.app('/');
  assert.equal(await page.text(), 'from a module beside it started 1');
});

test('the neighbor, as a boot directory, lends the governed mower; the fence holds, and the yard outlasts a restart', async t => {
  const { startToybox, pkg, makeDir } = await worldP;
  const dir = await makeDir('toybox-neighbor-');
  t.after(dir.remove);
  const boot = pkg.sub('examples/neighbor');
  /**
   * @param {Awaited<ReturnType<typeof startToybox>>} box
   * @param {number} pushes
   */
  const lend = async (box, pushes) => {
    const resp = await box.app('/run', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `pushes=${pushes}`,
      redirect: 'manual',
    });
    assert.equal(resp.status, 303);
  };
  /** @param {Awaited<ReturnType<typeof startToybox>>} box */
  const yard = async box => (await box.app('/')).text();

  await t.test('lend the mower', async t => {
    const box = await startToybox(dir, { boot });
    t.after(box.stop);
    assert.match(await yard(box), /0 of 64 cells cut/);
    await lend(box, 5);
    const page = await yard(box);
    assert.match(page, /4 of 64 cells cut/);
    assert.match(
      page,
      /<li>cut \(4, 4\)<\/li><li>cut \(4, 3\)<\/li><li>cut \(4, 2\)<\/li><li>cut \(4, 1\)<\/li><li>fence: 3 cells from start<\/li>/,
    );
  });

  await t.test('after a restart', async t => {
    const box = await startToybox(dir, { boot });
    t.after(box.stop);
    assert.match(await yard(box), /4 of 64 cells cut/);
    await lend(box, 1);
    assert.match(
      await yard(box),
      /<li>cut \(4, 1\)<\/li><li>fence: 3 cells from start<\/li>/,
    );
  });
});
