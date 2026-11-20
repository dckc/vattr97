/** @file Horton: who done it, among three parties' vats, after Miller, Donnelley, and Karp (2007). */
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
import { connect as netConnect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { E } from '@endo/far';
import workerdPackage from 'workerd';
import WebSocket from 'ws';
import { connect } from '../examples/horton/connect.js';
import { makeTree } from '../src/dir-tree.js';
import { makeToyboxes } from '../src/toyboxes.js';
import { makeWorkerd } from '../src/workerd-process.js';

/** @import { Remote } from '../src/types.js' */

/** Node's I/O, as this test uses it. */
const worldP = (async () => {
  const { freePort, startWorkerd } = makeWorkerd({
    workerd: workerdPackage.default,
    spawn,
    rm,
    connect: netConnect,
    createServer,
    sleep,
  });
  const fs = { chmod, cp, mkdir, readFile, rm, symlink, writeFile };
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
    /** The source of `examples/horton/${name}`. @param {string} name */
    src: name => pkg.readText(`examples/horton/${name}`),
    makeDir: async () =>
      makeTree(fs, await mkdtemp(join(tmpdir(), 'toybox-horton-'))),
  };
})();

const verbs = ['tidy', 'read', 'write', 'history'];

test('Horton: A says b.tidy(c), and each party can tell who done it', async t => {
  const { startToybox, src, makeDir } = await worldP;
  const dir = await makeDir();
  t.after(dir.remove);
  const box = await startToybox(dir);
  t.after(box.stop);
  const k = await box.admin('k1');
  t.after(k.close);

  /** @type {Remote[]} every vat's admin node */
  const admins = [];
  /** @param {string} name @param {object} [params] */
  const vat = async (name, params) => {
    const { root, adminNode } = await k.createVat(await src(name), params);
    admins.push(adminNode);
    return root;
  };
  const restartAll = () => Promise.all(admins.map(a => E(a).restart()));
  /** @param {string} label */
  const party = label => vat('horton.js', { label, verbs });

  const [alice, bob, carol] = await Promise.all(
    ['Alice', 'Bob', 'Carol'].map(party),
  );
  const page = await E(await vat('wiki.js')).makePage('hello    world');
  const tidier = await E(await vat('tidier.js')).getTidier();

  // base case: Alice reaches Bob's B and Carol's C
  const b = await connect(
    E,
    { horton: bob, petName: 'Bob' },
    { horton: alice, petName: 'Alice' },
    tidier,
  );
  const c = await connect(
    E,
    { horton: carol, petName: 'Carol' },
    { horton: alice, petName: 'Alice' },
    page,
  );

  await t.test(
    'the inductive case: Bob gets a path to C of his own',
    async () => {
      assert.equal(await E(b).tidy(c), 'tidied');
      assert.equal(await E(c).read(), 'hello world');
      assert.deepEqual(await E(alice).getLog(), [
        'asked Bob to tidy',
        'asked Carol to read',
      ]);
      // Bob and Carol have no pet names for each other: they show the names proposed
      assert.deepEqual(await E(bob).getLog(), [
        'Alice asked tidy',
        'asked "Carol" to read',
        'asked "Carol" to write',
      ]);
      assert.deepEqual(await E(carol).getLog(), [
        'Alice shared with "Bob"',
        '"Bob" asked read',
        '"Bob" asked write',
        'Alice asked read',
      ]);
    },
  );

  await t.test(
    'Carol blames Bob for scribbling, and shuts off Bob but not Alice; it all lasts across restarts',
    async () => {
      await restartAll();
      await E(tidier).scribble('spam');
      assert.equal((await E(carol).getLog()).at(-1), '"Bob" asked write');
      assert.equal(await E(c).read(), 'spam');

      await E(carol).shutOff(await E(bob).getWho());
      await restartAll();
      await assert.rejects(E(tidier).scribble('more spam'), /write: shut off/);
      await E(c).write('hello world');
      assert.deepEqual(await E(c).history(), [
        'hello    world',
        'hello world',
        'spam',
        'hello world',
      ]);
    },
  );

  await t.test(
    "a gift wrapped by someone else, allegedly from Carol, can't get Bob blaming Carol",
    async () => {
      const forger = await vat('forger.js');
      const forgerHorton = await party('Mallory');
      const s1 = await E(bob).makeStub(await E(forgerHorton).getWho(), tidier);
      await assert.rejects(
        E(forger).forge(
          s1,
          await E(bob).getWho(),
          await E(carol).getWho(),
          'tidy',
        ),
        /gift not provided/,
      );
      assert.equal(await E(c).read(), 'hello world');
    },
  );
});
