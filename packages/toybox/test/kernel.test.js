/** @file The kernel: vats as facets of one Durable Object, references through kernel-held c-lists. */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { createServer } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { E } from '@endo/far';
import workerdPackage from 'workerd';
import WebSocket from 'ws';
import { lendMower, makeNeighbors } from '../examples/neighbor/boot/lend.js';
import { makeTree } from '../src/dir-tree.js';
import { makeToyboxes } from '../src/toyboxes.js';
import { makeWorkerd } from '../src/workerd-process.js';
import { makeGit } from './git.js';
import { makeNix } from './nix.js';

/**
 * @import { RequestListener } from 'node:http';
 * @import { Remote } from '../src/types.js';
 */

const { values } = Object;

/**
 * Node's I/O, as these tests use it: the test is the edge, and each test
 * takes what it uses from here.
 */
const worldP = (async () => {
  const run = promisify(execFile);
  const { freePort, listenLocal, startWorkerd } = makeWorkerd({
    workerd: workerdPackage.default,
    spawn,
    rm,
    connect,
    createServer: createNetServer,
    sleep,
    // WORKERD_LOG=1 echoes workerd's stderr, for debugging
    log: process.env.WORKERD_LOG
      ? c => void process.stderr.write(c)
      : undefined,
  });
  const fs = { chmod, cp, mkdir, readFile, rm, symlink, writeFile };
  const pkg = makeTree(fs, fileURLToPath(new URL('..', import.meta.url)));
  /** A new directory of its own, for a test. @param {string} prefix */
  const makeDir = async prefix =>
    makeTree(fs, await mkdtemp(join(tmpdir(), prefix)));
  const { startToybox } = makeToyboxes({
    startWorkerd,
    freePort,
    pkg,
    fetch,
    WebSocket,
  });
  const { makeRepo } = makeGit({ run, makeScratchDir: () => makeDir('git-') });
  const { addToStore } = makeNix({ run });
  return {
    startToybox,
    pkg,
    makeDir,
    makeRepo,
    addToStore,
    /** The source of the kernel vat `name`, in examples/. @param {string} name */
    kvat: name => pkg.readText(`examples/${name}`),
    /**
     * A web site on 127.0.0.1, answering as `handler` does, until `close()`.
     *
     * @param {RequestListener} handler
     */
    serveLocal: async handler => {
      const site = createServer(handler);
      const port = await listenLocal(site);
      return {
        host: `127.0.0.1:${port}`,
        close: () => new Promise(resolve => site.close(resolve)),
      };
    },
  };
})();

test('vats in one kernel', async t => {
  const { startToybox, pkg, makeDir, makeRepo, addToStore, kvat, serveLocal } =
    await worldP;
  const dir = await makeDir('toybox-kernel-');
  t.after(dir.remove);
  const box = await startToybox(dir);
  t.after(box.stop);
  const k = await box.admin('k1');
  t.after(k.close);

  /** Upgrade the vat whose admin node is `adminNode` to `src`. @param {Remote} adminNode @param {string} src */
  const upgrade = async (adminNode, src) =>
    E(adminNode).upgrade(await k.installBundle(src));

  await t.test(
    'a durable counter counts on after its vat restarts',
    async () => {
      const { adminNode: admin, root } = await k.createVat(
        await kvat('counter.js'),
      );
      const counter = await E(root).getCounter();
      assert.equal(await E(counter).incr(), 1);
      assert.equal(await E(counter).incr(), 2);
      const ten = await E(root).makeCounter(10);
      await E(admin).restart();
      assert.equal(await E(counter).incr(), 3);
      assert.equal(await E(ten).incr(), 11);
    },
  );

  await t.test(
    'an ephemeral object is gone after its vat restarts',
    async () => {
      const { adminNode: admin, root } = await k.createVat(
        await kvat('ephemeral.js'),
      );
      const ticker = await E(root).getTicker();
      assert.equal(await E(ticker).tick(), 1);
      await E(admin).restart();
      await assert.rejects(
        E(ticker).tick(),
        /gone with an earlier incarnation/,
      );
    },
  );

  await t.test(
    'a terminated vat is gone: its objects refuse messages, from a session or another vat, and its admin node does nothing more',
    async () => {
      const { adminNode: admin, root } = await k.createVat(
        await kvat('counter.js'),
      );
      const { root: holder } = await k.createVat(await kvat('holder.js'));
      const counter = await E(root).getCounter();
      await E(holder).keep('c', counter);
      assert.equal(await E(holder).bump('c'), 1);
      const before = (await k.vats()).length;
      await E(admin).terminate();
      assert.equal((await k.vats()).length, before - 1);
      await assert.rejects(E(counter).incr(), /no such object/);
      await assert.rejects(E(holder).bump('c'), /no such object/);
      await assert.rejects(E(admin).restart(), /no such vat/);
      await assert.rejects(E(admin).terminate(), /no such vat/);
    },
  );

  await t.test(
    'a counter passed to another vat reaches its maker; identity holds; both vats restart',
    async () => {
      const { adminNode: a, root: counterRoot } = await k.createVat(
        await kvat('counter.js'),
      );
      const { adminNode: b, root: holder } = await k.createVat(
        await kvat('holder.js'),
      );
      const counter = await E(counterRoot).getCounter();
      await E(holder).keep('c', counter);
      assert.equal(await E(holder).bump('c'), 1);
      assert.equal(await E(counter).read(), 1);
      assert.equal(await E(holder).isKept('c', counter), true);
      assert.equal(
        await E(holder).isKept('c', await E(counterRoot).makeCounter()),
        false,
      );
      await E(b).restart();
      assert.equal(await E(holder).bump('c'), 2);
      await E(a).restart();
      assert.equal(await E(holder).bump('c'), 3);
      assert.equal(await E(holder).isKept('c', counter), true);
    },
  );

  await t.test(
    'a vat finds no clock or randomness, from its first line on',
    async () => {
      const { root } = await k.createVat(await kvat('probes/ambient.js'));
      const inert = {
        frozen: true,
        now: 'throws',
        date: 'throws',
        random: 'throws',
        crypto: ['subtle'],
        subtle: ['digest'],
        performance: 'throws',
      };
      assert.deepEqual(await E(root).atEvaluation(), inert);
      assert.deepEqual(await E(root).now(), inert);
      // SHA-256 of nothing starts e3: digests still work
      assert.equal(await E(root).digest(), 0xe3);
    },
  );

  await t.test(
    'a vat that calls its syscall directly reaches only what it holds',
    async () => {
      const { root: counterRoot } = await k.createVat(await kvat('counter.js'));
      const { root: forger } = await k.createVat(
        await kvat('probes/forger.js'),
      );
      const counter = await E(counterRoot).getCounter();

      assert.match(
        await E(forger).target('o-1', 'incr'),
        /^refused: "v\d+" holds no "o-1"$/,
      );

      await E(forger).hold(counter);
      assert.equal(await E(forger).target('o-1', 'incr'), 'reached: #1');
      assert.match(
        await E(forger).target('o-2', 'incr'),
        /^refused: "v\d+" holds no "o-2"$/,
      );
      assert.match(
        await E(forger).slot('o-1', 'incr', 'o-9'),
        /^refused: "v\d+" holds no "o-9"$/,
      );

      // the counter's own vref, claimed as an export: it names only the forger's objects
      assert.match(
        await E(forger).target('o+d1/1', 'incr'),
        /^refused: o\+d1\/1: its kind is not defined/,
      );
      assert.equal(await E(counter).read(), 1);
    },
  );

  await t.test(
    'payments move between vats through a deposit facet, which cannot withdraw; spent and counterfeit ones are refused; balances survive restarts',
    async () => {
      const { adminNode: mintAdmin, root: mintRoot } = await k.createVat(
        await kvat('rights-transfer/mint.js'),
      );
      const { adminNode: aliceAdmin, root: alice } = await k.createVat(
        await kvat('rights-transfer/payer.js'),
      );
      const { root: other } = await k.createVat(await kvat('ephemeral.js'));
      const issuer = await E(mintRoot).getIssuer();
      const mint = await E(mintRoot).getMint();
      const bobPurse = await E(issuer).makeEmptyPurse();
      const bobDeposit = await E(bobPurse).getDepositFacet();
      assert.equal(await E(bobPurse).getDepositFacet(), bobDeposit);
      await assert.rejects(E(bobDeposit).withdraw(1), /withdraw/);
      await E(alice).setPayee(bobDeposit);

      const ten = await E(mint).mintPayment(10);
      assert.equal(await E(alice).pay(ten), 10);
      assert.equal(await E(bobPurse).getBalance(), 10);
      await assert.rejects(
        E(alice).pay(ten),
        /not a live payment of this mint/,
      );
      await assert.rejects(
        E(alice).pay(await E(other).getTicker()),
        /not a live payment of this mint/,
      );

      const three = await E(bobPurse).withdraw(3);
      assert.equal(await E(issuer).isLive(three), true);
      await E(mintAdmin).restart();
      await E(aliceAdmin).restart();
      assert.equal(await E(alice).pay(three), 3);
      assert.equal(await E(alice).pay(await E(mint).mintPayment(5)), 5);
      assert.equal(await E(bobPurse).getBalance(), 15);
      await assert.rejects(E(bobPurse).withdraw(16), /insufficient funds/);
    },
  );

  await t.test(
    'lend the mower: the tenant holds only the governed mower; the fence holds across restarts',
    async () => {
      /** @type {Record<string, Remote>} each vat's admin node, by role */
      const admins = {};
      const neighbors = await makeNeighbors(async (role, name) => {
        const { root, adminNode } = await k.createVat(
          await kvat(`neighbor/${name}`),
        );
        admins[role] = adminNode;
        return root;
      });
      const { mower, governed, tenant } = await lendMower(E, neighbors, 2);

      assert.deepEqual(await E(tenant).run(governed, 5), [
        'cut (4, 4)',
        'cut (4, 3)',
        'cut (4, 2)',
        'fence: 2 cells from start',
      ]);
      await E(admins.mowers).restart();
      await E(admins.governor).restart();
      assert.deepEqual(await E(tenant).run(governed, 1), [
        'cut (4, 2)',
        'fence: 2 cells from start',
      ]);
      assert.deepEqual(await E(mower).getCut(), [
        '(4, 4)',
        '(4, 3)',
        '(4, 2)',
        '(4, 2)',
      ]);
    },
  );

  await t.test(
    "upgrading a vat's code keeps its durable objects, and others' references to them",
    async () => {
      const { adminNode: admin, root } = await k.createVat(
        await kvat('counter.js'),
      );
      const { root: holder } = await k.createVat(await kvat('holder.js'));
      const counter = await E(root).getCounter();
      await E(holder).keep('c', counter);
      assert.equal(await E(holder).bump('c'), 1);
      await upgrade(admin, await kvat('counter-v2.js'));
      assert.equal(await E(holder).bump('c'), 11);
      assert.equal(await E(counter).incr(), 21);
      await assert.rejects(
        upgrade(
          admin,
          "export const buildRootObject = () => { throw Error('broken'); };",
        ),
        /broken/,
      );
      assert.equal(await E(holder).bump('c'), 31);
      await assert.rejects(
        E(admin).upgrade(await k.makeDevice('fetch')),
        /not a bundleCap/,
      );
    },
  );

  await t.test(
    "an exoClassKit's facets share one state, each is its own reference, and both outlive a restart",
    async () => {
      const { adminNode: admin, root } = await k.createVat(
        await kvat('counter-kit.js'),
      );
      const { root: holder } = await k.createVat(await kvat('holder.js'));
      const [incr, read] = [await E(root).getIncr(), await E(root).getRead()];
      assert.notEqual(incr, read);
      await E(holder).keep('read', read);
      assert.equal(await E(incr).incr(), 1);
      assert.equal(await E(E(holder).get('read')).read(), 1);
      // a facet has only its own methods, and takes only what its guard says
      await assert.rejects(E(read).incr(), /no method incr/);
      await assert.rejects(E(incr).incr('more'), /incr.*arguments/);

      const other = await E(root).makeKit();
      assert.equal(await E(other.incr).incr(), 1);
      await E(admin).restart();
      assert.equal(await E(incr).incr(), 2);
      assert.equal(await E(E(holder).get('read')).read(), 2);
      assert.equal(await E(other.read).read(), 1);
    },
  );

  await t.test(
    'upgrading may not change a kind between one facet and a kit: references to its objects are stored by facet',
    async () => {
      const { adminNode: admin, root } = await k.createVat(
        await kvat('counter.js'),
      );
      const counter = await E(root).getCounter();
      assert.equal(await E(counter).incr(), 1);
      const asKit = (await kvat('counter-kit.js')).replaceAll(
        "'CounterKit'",
        "'Counter'",
      );
      await assert.rejects(
        upgrade(admin, asKit),
        /kind Counter had facets self; it can't have \["incr","read"\] now/,
      );
      assert.equal(await E(counter).incr(), 2);

      const { adminNode: kitAdmin } = await k.createVat(
        await kvat('counter-kit.js'),
      );
      const fewer = (await kvat('counter-kit.js')).replace(
        /\n {6}read: \{[\s\S]*?\n {6}\},/,
        '',
      );
      await assert.rejects(
        upgrade(kitAdmin, fewer),
        /kind CounterKit had facets/,
      );
    },
  );

  await t.test('a vat whose root fails to build is forgotten', async () => {
    const before = (await k.vats()).length;
    await assert.rejects(
      k.createVat(
        "export const buildRootObject = () => { throw Error('no root'); };",
      ),
      /no root/,
    );
    assert.equal((await k.vats()).length, before);
    const { root } = await k.createVat(await kvat('counter.js'));
    assert.equal(await E(E(root).getCounter()).incr(), 1);
    assert.equal((await k.vats()).length, before + 1);
  });

  await t.test(
    'a vatAdmin creates vats only from bundleCaps; a bundle has one bundleCap',
    async () => {
      const vatAdmin = await k.makeVatAdmin();
      const src = await kvat('counter.js');
      const bundleCap = await k.installBundle(src);
      assert.equal(await k.installBundle(src), bundleCap);
      const { root } = await E(vatAdmin).createVat(bundleCap, {});
      assert.equal(await E(E(root).getCounter()).incr(), 1);

      const hash = createHash('sha256').update(src).digest('hex');
      // the guard refuses what isn't a reference at all; the kernel, any other reference
      await assert.rejects(
        E(vatAdmin).createVat(hash, {}),
        /Must be a remotable BundleCap/,
      );
      await assert.rejects(
        E(vatAdmin).createVat(`bundle:sha256:${hash}`, {}),
        /Must be a remotable BundleCap/,
      );
      await assert.rejects(
        E(vatAdmin).createVat(await k.makeDevice('fetch'), {}),
        /not a bundleCap/,
      );
      await assert.rejects(
        E(bundleCap).getBundle(),
        /a BundleCap has no getBundle/,
      );
    },
  );

  await t.test('a session makes only the devices there are', async () => {
    await assert.rejects(k.makeDevice('nope'), /no device nope/);
    await assert.rejects(k.makeDevice('__proto__'), /no device __proto__/);
  });

  await t.test(
    'a nixStore makes a bundleCap for a file in the store, and refuses anything else',
    async () => {
      const vatAdmin = await k.makeVatAdmin();
      const nixStore = await k.makeDevice('nixStore');
      const storePath = await addToStore(pkg.path('examples/counter.js'));
      const bundleCap = await E(nixStore).getBundleCap(storePath);
      assert.equal(await E(nixStore).getBundleCap(storePath), bundleCap);
      const { root } = await E(vatAdmin).createVat(bundleCap, {});
      assert.equal(await E(E(root).getCounter()).incr(), 1);

      await assert.rejects(
        E(nixStore).getBundleCap(pkg.path('examples/counter.js')),
        /not a store path/,
      );
      await assert.rejects(
        E(nixStore).getBundleCap('/nix/store/../../etc/passwd'),
        /not a store path/,
      );
      await assert.rejects(
        E(nixStore).getBundleCap(
          '/nix/store/00000000000000000000000000000000-nothing.js',
        ),
        /is not in the nix store/,
      );
      await assert.rejects(
        E(nixStore).getBundleCap(await addToStore(pkg.path('examples'))),
        /has no worker.json/,
      );
    },
  );

  await t.test(
    'a nixStore bundle can be a directory of modules, its main one named by worker.json',
    async t => {
      const vatAdmin = await k.makeVatAdmin();
      const nixStore = await k.makeDevice('nixStore');
      const bundleCap = await E(nixStore).getBundleCap(
        await addToStore(pkg.path('test/greeter')),
      );
      const { adminNode: admin, root } = await E(vatAdmin).createVat(
        bundleCap,
        {},
      );
      assert.equal(await E(root).greet('Fred'), 'Hello, Fred (#1)');
      await E(admin).restart();
      assert.equal(await E(root).greet('Fred'), 'Hello, Fred (#2)');

      const withLink = await makeDir('toybox-symlink-');
      t.after(withLink.remove);
      await pkg.copy('test/greeter', withLink);
      await withLink.symlink('main.js', 'alias.js');
      await assert.rejects(
        E(nixStore).getBundleCap(await addToStore(withLink.path())),
        /alias.js is a symlink/,
      );
    },
  );

  await t.test(
    "git trees read only the files a git tree lists, and only while they're what it says",
    async () => {
      const checkout = dir.sub('checkout');
      // more than one chunk's worth, with a multi-byte character to cut around
      const big = Array.from({ length: 5000 }, (_, i) =>
        JSON.stringify([i, 'Café Ñandú', 'x'.repeat(i % 50)]),
      ).join('\n');
      await checkout.writeText('big.ndjson', big);
      const { tree, listing } = await makeRepo(
        pkg.sub('test/greeter'),
        'greeter',
        checkout,
      );
      await checkout.writeText(
        'elsewhere.txt',
        'in the checkout, not the tree',
      );
      const gitTrees = await k.makeDevice('gitTrees');
      const greeter = await E(gitTrees).getTree(tree, listing);
      assert.deepEqual(await E(greeter).list(), [
        'big.ndjson',
        'greeter/greeting.txt',
        'greeter/lib/count.js',
        'greeter/main.js',
        'greeter/worker.json',
      ]);

      await assert.rejects(
        E(gitTrees).getTree('0'.repeat(40), listing),
        new RegExp(`listing is of tree ${tree}, not 0{40}`),
      );
      // no id given: the listing, -z or not, names the tree
      assert.equal(
        await E(E(gitTrees).getTree(null, listing.replaceAll('\0', '\n'))).id(),
        tree,
      );
      assert.equal(await E(greeter).id(), tree);
      await assert.rejects(
        E(greeter).read('elsewhere.txt'),
        /has no file "elsewhere.txt"/,
      );
      await assert.rejects(
        E(greeter).read('greeter/../elsewhere.txt'),
        /has no file/,
      );
      assert.match(await E(greeter).read('greeter/greeting.txt'), /Hello/);
      const greeting = await checkout.readText('greeter/greeting.txt');
      await checkout.writeText(
        'greeter/greeting.txt',
        `${greeting}a forged line\n`,
      );
      await assert.rejects(
        E(greeter).read('greeter/greeting.txt'),
        /is not what tree [0-9a-f]{40} has; it changed since/,
      );

      const reader = await E(greeter).open('big.ndjson');
      const chunks = [];
      for (let r = await E(reader).next(); !r.done; r = await E(reader).next())
        chunks.push(r.value);
      assert.ok(chunks.length > 1);
      assert.ok(chunks.slice(0, -1).every(c => c.endsWith('\n')));
      assert.equal(chunks.join(''), big);
      assert.deepEqual(await E(reader).next(), {
        done: true,
        value: undefined,
      });
      await assert.rejects(
        E(greeter).open('greeter/greeting.txt'),
        /changed since/,
      );

      // a file that changes while it's read: what was given out can't be done
      const midway = await E(greeter).open('big.ndjson');
      assert.equal((await E(midway).next()).done, false);
      await checkout.writeText('big.ndjson', big.replaceAll('a', 'b'));
      const draining = async () => {
        for (
          let r = await E(midway).next();
          !r.done;
          r = await E(midway).next()
        );
      };
      await assert.rejects(draining(), /changed since/);
      await assert.rejects(E(midway).next(), /changed since/);
    },
  );

  await t.test(
    "a vat's db is its own SQLite, and outlasts a restart",
    async () => {
      const { adminNode: admin, root } = await k.createVat(
        await kvat('notes.js'),
      );
      // one row changed, though the note's index is written too
      assert.equal(await E(root).add('one'), 1);
      await E(root).add('two');
      await E(admin).restart();
      assert.deepEqual(await E(root).list(), ['one', 'two']);
      // a transaction: all of them, or none
      await assert.rejects(E(root).addAll(['three', '']), /an empty note/);
      assert.deepEqual(await E(root).addAll(['three', 'four']), [1, 1]);
      assert.deepEqual(await E(root).list(), ['one', 'two', 'three', 'four']);
      const { root: other } = await k.createVat(await kvat('notes.js'));
      assert.deepEqual(await E(other).list(), []);
    },
  );

  await t.test(
    'an ingress answers a status that has no body, and a 502 when its handler throws',
    async () => {
      await assert.rejects(
        // @ts-expect-error a label's value is a string
        k.makeIngress({ site: 'answers', n: 1 }),
        /label n is not a string/,
      );
      const ingress = await k.makeIngress({ site: 'answers' });
      await k.createVat(await kvat('probes/ingress.js'), { ingress });
      /** @param {string} path */
      const get = path => box.http(path);
      for (const status of [200, 204, 304]) {
        const resp = await get(`/?site=answers&status=${status}`);
        assert.equal(resp.status, status);
        assert.equal(await resp.text(), status === 200 ? 'body' : '');
      }
      // a label may have any name that isn't given twice
      assert.equal(
        (await get('/?site=answers&status=200&constructor=x')).status,
        200,
      );
      assert.equal(
        (await get('/?site=answers&status=200&site=answers')).status,
        400,
      );
      const failed = await get('/throw?site=answers&status=200');
      assert.equal(failed.status, 502);
      assert.doesNotMatch(await failed.text(), /asked to throw/);
    },
  );

  await t.test(
    "a LAN device reaches only what config.capnp's lan service allows: private addresses, not loopback",
    async t => {
      const site = await serveLocal((req, res) => res.end('hi'));
      t.after(site.close);
      const url = `http://${site.host}/`;
      for (const device of [
        await k.makeDevice('lan'),
        await k.makeDevice('fetch'),
      ])
        await assert.rejects(E(device).fetch(url), /internal error/);
    },
  );
});

test("after the whole toybox crashes, vats' references to each other still work", async t => {
  const { startToybox, makeDir, kvat } = await worldP;
  // its own toybox: a crash breaks every session to it
  const dir = await makeDir('toybox-kernel-crash-');
  t.after(dir.remove);

  await t.test('vats that refer to each other', async t => {
    const box = await startToybox(dir);
    t.after(box.stop);
    const client = await box.admin('crashy');
    t.after(client.close);
    const { root: mintRoot } = await client.createVat(
      await kvat('rights-transfer/mint.js'),
    );
    const { root: alice } = await client.createVat(
      await kvat('rights-transfer/payer.js'),
    );
    const { root: holder } = await client.createVat(await kvat('holder.js'));
    const purse = await E(await E(mintRoot).getIssuer()).makeEmptyPurse();
    await E(alice).setPayee(await E(purse).getDepositFacet());
    await E(holder).keep('purse', purse);
    await E(holder).keep('mint', await E(mintRoot).getMint());
  });

  await t.test('after a crash', async t => {
    const box = await startToybox(dir);
    t.after(box.stop);
    const client = await box.admin('crashy');
    t.after(client.close);
    // a new session finds the vats again by their order of making
    const [, { root: alice }, { root: holder }] = await client.vats();
    const mint = await E(holder).get('mint');
    assert.equal(await E(alice).pay(await E(mint).mintPayment(7)), 7);
    assert.equal(await E(await E(holder).get('purse')).getBalance(), 7);
  });
});

test('a kernel vat serves the web through its ingress, after a restart and after a crash', async t => {
  const { startToybox, makeDir, kvat } = await worldP;
  const dir = await makeDir('toybox-kernel-web-');
  t.after(dir.remove);

  await t.test('through a restart', async t => {
    const box = await startToybox(dir);
    t.after(box.stop);
    /** @param {string} path */
    const get = path => box.http(path);
    const client = await box.admin('web');
    t.after(client.close);
    assert.equal((await get('/?site=hello')).status, 404);
    const ingress = await client.makeIngress({ site: 'hello' });
    assert.equal((await get('/?site=hello')).status, 503);
    await assert.rejects(client.makeIngress({ site: 'hello' }), /overlaps/);
    const { adminNode: admin } = await client.createVat(
      await kvat('hello-page.js'),
      { ingress },
    );
    const first = await get('/greet?site=hello');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('content-type'), 'text/html; charset=utf-8');
    // a page here runs no scripts: every mount shares this origin
    assert.equal(
      first.headers.get('content-security-policy'),
      "script-src 'none'",
    );
    assert.match(await first.text(), /from a kernel vat, at \/greet, hit 1</);
    await E(admin).restart();
    assert.match(await (await get('/again?site=hello')).text(), /hit 2</);
  });

  // nobody reconnects: the kernel holds the handler's kref, and its vat starts on demand
  await t.test('after a crash', async t => {
    const box = await startToybox(dir);
    t.after(box.stop);
    assert.match(
      await (await box.http('/after-crash?site=hello')).text(),
      /at \/after-crash, hit 3</,
    );
  });
});

test('a bootstrap vat wires a bookmark cache from nix store code; the cache serves its page through an ingress, from a git-tree template; the cookie rotates', async t => {
  const { startToybox, pkg, makeDir, makeRepo, addToStore, kvat, serveLocal } =
    await worldP;
  const dir = await makeDir('toybox-kernel-cache-');
  t.after(dir.remove);
  const site = await serveLocal((req, res) =>
    res.end(`${req.method} ${req.url} cookie=${req.headers.cookie ?? 'none'}`),
  );
  t.after(site.close);
  const { host } = site;
  const box = await startToybox(dir, { config: 'test/config-local.capnp' });
  t.after(box.stop);
  const client = await box.admin('cache');
  t.after(client.close);
  // the site's templates, as a git tree of the toybox's checkout
  const { tree, listing } = await makeRepo(
    pkg.sub('examples/bookmarks/templates'),
    'templates',
    dir.sub('checkout'),
  );
  const { root: boot, adminNode: bootAdmin } = await client.createVat(
    await kvat('bookmarks/boot.js'),
    {
      vatAdmin: await client.makeVatAdmin(),
      nixStore: await client.makeDevice('nixStore'),
      paths: {
        webApp: await addToStore(pkg.path('examples/webapp.js')),
        storeMaker: await addToStore(pkg.path('examples/store-maker.js')),
        cache: await addToStore(pkg.path('examples/bookmarks/cache.js')),
      },
      fetch: await client.makeDevice('fetch'),
      ingress: await client.makeIngress({ app: 'bookmarks' }),
      templates: await E(await client.makeDevice('gitTrees')).getTree(
        tree,
        listing,
      ),
    },
  );
  const { cache, admins } = await E(boot).bootstrap(
    `http://${host}/bookmarks/`,
  );
  const page = async () => (await box.http('/?app=bookmarks')).text();
  assert.match(await page(), /<pre>\(none yet\)<\/pre>/);
  assert.equal(await E(cache).refresh(), 'GET /bookmarks/ cookie=none');
  await E(boot).setCookie('session=1');
  assert.equal(await E(cache).refresh(), 'GET /bookmarks/ cookie=session=1');

  for (const admin of [bootAdmin, ...values(admins)]) await E(admin).restart();
  assert.equal(await E(cache).latest(), 'GET /bookmarks/ cookie=session=1');
  assert.match(await page(), /<pre>GET \/bookmarks\/ cookie=session=1<\/pre>/);
  await E(boot).setCookie('session=2');
  assert.equal(await E(cache).refresh(), 'GET /bookmarks/ cookie=session=2');

  // here the lan service allows loopback, where this test's site is
  const lan = await client.makeDevice('lan');
  assert.deepEqual(
    (({ status, body }) => ({ status, body }))(
      await E(lan).fetch(`http://${host}/models`),
    ),
    { status: 200, body: 'GET /models cookie=none' },
  );
});
