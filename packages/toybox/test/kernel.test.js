/** @file The kernel: vats as facets of one Durable Object, references through kernel-held c-lists. */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFile,
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
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { E } from '@endo/far';
import workerdPackage from 'workerd';
import WebSocket from 'ws';
import { connectKernel } from '../kernel-client.js';
import { makeGit } from './git.js';
import { makeNix } from './nix.js';
import { makeToyboxes } from './toybox.js';
import { here, makeWorkerd } from '../workerd-process.js';

const { values } = Object;

// this test is the edge: it holds Node's I/O, and gives each helper what it uses
const run = promisify(execFile);
const { freePort, listenLocal, startWorkerd } = makeWorkerd({
  workerd: workerdPackage.default,
  spawn,
  rm,
  connect,
  createServer: createNetServer,
  sleep,
  // WORKERD_LOG=1 echoes workerd's stderr, for debugging
  log: process.env.WORKERD_LOG ? c => void process.stderr.write(c) : undefined,
});
const { makeRepo } = makeGit({
  run,
  cp,
  makeScratchDir: () => mkdtemp(join(tmpdir(), 'git-tree-')),
});
const { addToStore } = makeNix({ run });
const { startToybox } = makeToyboxes({ startWorkerd, freePort, mkdir });
/** A client of the kernel `name` on the admin socket `sock`. @param {string} sock @param {string} name */
const connectTo = (sock, name) =>
  connectKernel(new WebSocket(`ws+unix:${sock}:/kernel/${name}`));

/** @import { Remote } from '../types.js' */

/** @param {string} name */
const kvat = name => readFile(join(here, 'kvats', name), 'utf8');

/** Upgrade the vat whose admin node is `adminNode` to `src`. @param {Remote} adminNode @param {string} src */
const upgrade = async (adminNode, src) =>
  E(adminNode).upgrade(await k.installBundle(src));

/** @type {string} */
let dir;
/** @type {Awaited<ReturnType<typeof startToybox>>} */
let toybox;
/** @type {Awaited<ReturnType<typeof connectKernel>>} */
let k;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'toybox-kernel-'));
  await mkdir(join(dir, 'state'));
  toybox = await startToybox(dir);
  k = await connectTo(toybox.sock, 'k1');
});

after(async () => {
  k?.close();
  await toybox?.server.stop();
  await rm(dir, { recursive: true, force: true });
});

test('a durable counter counts on after its vat restarts', async () => {
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
});

test('an ephemeral object is gone after its vat restarts', async () => {
  const { adminNode: admin, root } = await k.createVat(
    await kvat('ephemeral.js'),
  );
  const ticker = await E(root).getTicker();
  assert.equal(await E(ticker).tick(), 1);
  await E(admin).restart();
  await assert.rejects(E(ticker).tick(), /gone with an earlier incarnation/);
});

test('a counter passed to another vat reaches its maker; identity holds; both vats restart', async () => {
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
});

test('a vat finds no clock or randomness, from its first line on', async () => {
  const { root } = await k.createVat(await kvat('ambient.js'));
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
});

test('a vat that calls its syscall directly reaches only what it holds', async () => {
  const { root: counterRoot } = await k.createVat(await kvat('counter.js'));
  const { root: forger } = await k.createVat(await kvat('forger.js'));
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
});

test('payments move between vats into a purse; spent and counterfeit ones are refused; balances survive restarts', async () => {
  const { adminNode: mintAdmin, root: mintRoot } = await k.createVat(
    await kvat('mint.js'),
  );
  const { adminNode: aliceAdmin, root: alice } = await k.createVat(
    await kvat('alice.js'),
  );
  const { root: other } = await k.createVat(await kvat('ephemeral.js'));
  const issuer = await E(mintRoot).getIssuer();
  const mint = await E(mintRoot).getMint();
  const bobPurse = await E(issuer).makeEmptyPurse();
  await E(alice).setPayee(bobPurse);

  const ten = await E(mint).mintPayment(10);
  assert.equal(await E(alice).pay(ten), 10);
  assert.equal(await E(bobPurse).getBalance(), 10);
  await assert.rejects(E(alice).pay(ten), /not a live payment of this mint/);
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
});

test('lend the mower: the tenant holds only the governed mower; the fence holds across restarts', async () => {
  const { adminNode: mowerAdmin, root: mowers } = await k.createVat(
    await kvat('mower.js'),
  );
  const { adminNode: governorAdmin, root: governor } = await k.createVat(
    await kvat('governor.js'),
  );
  const { root: tenant } = await k.createVat(await kvat('tenant.js'));
  const mower = await E(mowers).makeMower();
  const governed = await E(governor).govern(mower, 2);

  assert.deepEqual(await E(tenant).run(governed, 5), [
    'cut (4, 4)',
    'cut (4, 3)',
    'cut (4, 2)',
    'fence: 2 cells from start',
  ]);
  await E(mowerAdmin).restart();
  await E(governorAdmin).restart();
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
});

test("after the whole toybox crashes, vats' references to each other still work", async () => {
  // its own toybox: a crash breaks every session to it
  const home = await mkdtemp(join(tmpdir(), 'toybox-kernel-crash-'));
  await mkdir(join(home, 'state'));
  let box = await startToybox(home);
  try {
    let client = await connectTo(box.sock, 'crashy');
    const { root: mintRoot } = await client.createVat(await kvat('mint.js'));
    const { root: alice } = await client.createVat(await kvat('alice.js'));
    const { root: holder } = await client.createVat(await kvat('holder.js'));
    const purse = await E(await E(mintRoot).getIssuer()).makeEmptyPurse();
    await E(alice).setPayee(purse);
    await E(holder).keep('purse', purse);
    await E(holder).keep('mint', await E(mintRoot).getMint());
    client.close();

    await box.server.stop();
    box = await startToybox(home);
    client = await connectTo(box.sock, 'crashy');
    // a new session finds the vats again by their order of making
    const [, { root: alice2 }, { root: holder2 }] = await client.vats();
    const mint = await E(holder2).get('mint');
    assert.equal(await E(alice2).pay(await E(mint).mintPayment(7)), 7);
    assert.equal(await E(await E(holder2).get('purse')).getBalance(), 7);
    client.close();
  } finally {
    await box.server.stop();
    await rm(home, { recursive: true, force: true });
  }
});

test("upgrading a vat's code keeps its durable objects, and others' references to them", async () => {
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
    E(admin).upgrade(await k.makeFetchDevice()),
    /not a bundleCap/,
  );
});

test("an exoClassKit's facets share one state, each is its own reference, and both outlive a restart", async () => {
  const { adminNode: admin, root } = await k.createVat(await kvat('kit.js'));
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
});

test('upgrading may not change a kind between one facet and a kit: references to its objects are stored by facet', async () => {
  const { adminNode: admin, root } = await k.createVat(
    await kvat('counter.js'),
  );
  const counter = await E(root).getCounter();
  assert.equal(await E(counter).incr(), 1);
  const asKit = (await kvat('kit.js')).replaceAll("'CounterKit'", "'Counter'");
  await assert.rejects(
    upgrade(admin, asKit),
    /kind Counter had facets self; it can't have \["incr","read"\] now/,
  );
  assert.equal(await E(counter).incr(), 2);

  const { adminNode: kitAdmin } = await k.createVat(await kvat('kit.js'));
  const fewer = (await kvat('kit.js')).replace(
    /\n {6}read: \{[\s\S]*?\n {6}\},/,
    '',
  );
  await assert.rejects(upgrade(kitAdmin, fewer), /kind CounterKit had facets/);
});

test('a vat whose root fails to build is forgotten', async () => {
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

test('a vatAdmin creates vats only from bundleCaps; a bundle has one bundleCap', async () => {
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
    E(vatAdmin).createVat(await k.makeFetchDevice(), {}),
    /not a bundleCap/,
  );
  await assert.rejects(
    E(bundleCap).getBundle(),
    /a BundleCap has no getBundle/,
  );
});

test('a nixStore makes a bundleCap for a file in the store, and refuses anything else', async () => {
  const vatAdmin = await k.makeVatAdmin();
  const nixStore = await k.makeNixStore();
  const storePath = await addToStore(join(here, 'kvats', 'counter.js'));
  const bundleCap = await E(nixStore).getBundleCap(storePath);
  assert.equal(await E(nixStore).getBundleCap(storePath), bundleCap);
  const { root } = await E(vatAdmin).createVat(bundleCap, {});
  assert.equal(await E(E(root).getCounter()).incr(), 1);

  await assert.rejects(
    E(nixStore).getBundleCap(join(here, 'kvats', 'counter.js')),
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
    E(nixStore).getBundleCap(await addToStore(join(here, 'kvats'))),
    /has no worker.json/,
  );
});

test('a nixStore bundle can be a directory of modules, its main one named by worker.json', async () => {
  const vatAdmin = await k.makeVatAdmin();
  const nixStore = await k.makeNixStore();
  const bundleCap = await E(nixStore).getBundleCap(
    await addToStore(join(here, 'test', 'greeter')),
  );
  const { adminNode: admin, root } = await E(vatAdmin).createVat(bundleCap, {});
  assert.equal(await E(root).greet('Fred'), 'Hello, Fred (#1)');
  await E(admin).restart();
  assert.equal(await E(root).greet('Fred'), 'Hello, Fred (#2)');

  const withLink = await mkdtemp(join(tmpdir(), 'toybox-symlink-'));
  await cp(join(here, 'test', 'greeter'), withLink, { recursive: true });
  await symlink('main.js', join(withLink, 'alias.js'));
  await assert.rejects(
    E(nixStore).getBundleCap(await addToStore(withLink)),
    /alias.js is a symlink/,
  );
  await rm(withLink, { recursive: true });
});

test("a git worktree reads only the files a git tree lists, and only while they're what it says", async () => {
  const worktree = join(dir, 'worktree');
  // more than one chunk's worth, with a multi-byte character to cut around
  const big = Array.from({ length: 5000 }, (_, i) =>
    JSON.stringify([i, 'Café Ñandú', 'x'.repeat(i % 50)]),
  ).join('\n');
  await writeFile(join(worktree, 'big.ndjson'), big);
  const { tree, listing } = await makeRepo(
    join(here, 'test', 'greeter'),
    'greeter',
    worktree,
  );
  await writeFile(
    join(worktree, 'elsewhere.txt'),
    'in the worktree, not the tree',
  );
  const gitWorktree = await k.makeGitWorktree();
  const greeter = await E(gitWorktree).getTree(tree, listing);
  assert.deepEqual(await E(greeter).list(), [
    'big.ndjson',
    'greeter/greeting.txt',
    'greeter/lib/count.js',
    'greeter/main.js',
    'greeter/worker.json',
  ]);

  await assert.rejects(
    E(gitWorktree).getTree('0'.repeat(40), listing),
    new RegExp(`listing is of tree ${tree}, not 0{40}`),
  );
  // no id given: the listing, -z or not, names the tree
  assert.equal(
    await E(E(gitWorktree).getTree(null, listing.replaceAll('\0', '\n'))).id(),
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
  await appendFile(
    join(worktree, 'greeter', 'greeting.txt'),
    'a forged line\n',
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
  assert.deepEqual(await E(reader).next(), { done: true, value: undefined });
  await assert.rejects(
    E(greeter).open('greeter/greeting.txt'),
    /changed since/,
  );

  // a file that changes while it's read: what was given out can't be done
  const midway = await E(greeter).open('big.ndjson');
  assert.equal((await E(midway).next()).done, false);
  await writeFile(join(worktree, 'big.ndjson'), big.replaceAll('a', 'b'));
  const draining = async () => {
    for (let r = await E(midway).next(); !r.done; r = await E(midway).next());
  };
  await assert.rejects(draining(), /changed since/);
  await assert.rejects(E(midway).next(), /changed since/);
});

test("a vat's db is its own SQLite, and outlasts a restart", async () => {
  const { adminNode: admin, root } = await k.createVat(await kvat('notes.js'));
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
});

test('a kernel vat serves the web through its ingress, after a restart and after a crash', async () => {
  const home = await mkdtemp(join(tmpdir(), 'toybox-kernel-web-'));
  await mkdir(join(home, 'state'));
  let box = await startToybox(home);
  /** @param {string} path */
  const get = path => fetch(`http://127.0.0.1:${box.port}${path}`);
  try {
    const client = await connectTo(box.sock, 'web');
    assert.equal((await get('/?site=hello')).status, 404);
    const ingress = await client.makeIngress({ site: 'hello' });
    assert.equal((await get('/?site=hello')).status, 503);
    await assert.rejects(client.makeIngress({ site: 'hello' }), /overlaps/);
    const { adminNode: admin } = await client.createVat(
      await kvat('hello.js'),
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
    client.close();

    // nobody reconnects: the kernel holds the handler's kref, and its vat starts on demand
    await box.server.stop();
    box = await startToybox(home);
    assert.match(
      await (await get('/after-crash?site=hello')).text(),
      /at \/after-crash, hit 3</,
    );
  } finally {
    await box.server.stop();
    await rm(home, { recursive: true, force: true });
  }
});

test('an ingress answers a status that has no body, and a 502 when its handler throws', async () => {
  await assert.rejects(
    // @ts-expect-error a label's value is a string
    k.makeIngress({ site: 'answers', n: 1 }),
    /label n is not a string/,
  );
  const ingress = await k.makeIngress({ site: 'answers' });
  await k.createVat(await kvat('answers.js'), { ingress });
  /** @param {string} path */
  const get = path => fetch(`http://127.0.0.1:${toybox.port}${path}`);
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
});

test("a LAN device reaches only what config.capnp's lan service allows: private addresses, not loopback", async () => {
  const site = createServer((req, res) => res.end('hi'));
  const port = await listenLocal(site);
  try {
    const url = `http://127.0.0.1:${port}/`;
    for (const device of [await k.makeLanDevice(), await k.makeFetchDevice()])
      await assert.rejects(E(device).fetch(url), /internal error/);
  } finally {
    await new Promise(resolve => site.close(resolve));
  }
});

test('a bootstrap vat wires a bookmark cache from nix store code; the cache serves its page through an ingress, from a git-tree template; the cookie rotates', async () => {
  const home = await mkdtemp(join(tmpdir(), 'toybox-kernel-cache-'));
  await mkdir(join(home, 'state'));
  const site = createServer((req, res) =>
    res.end(`${req.method} ${req.url} cookie=${req.headers.cookie ?? 'none'}`),
  );
  const host = `127.0.0.1:${await listenLocal(site)}`;
  /** @type {Awaited<ReturnType<typeof startToybox>> | undefined} */
  let box;
  try {
    box = await startToybox(home, { config: 'test/config-local.capnp' });
    const { port } = box;
    const client = await connectTo(box.sock, 'cache');
    // the site's templates, as a git tree of the toybox's worktree
    const { tree, listing } = await makeRepo(
      join(here, 'kvats', 'bookmark-templates'),
      'templates',
      join(home, 'worktree'),
    );
    const { root: boot, adminNode: bootAdmin } = await client.createVat(
      await kvat('cache-boot.js'),
      {
        vatAdmin: await client.makeVatAdmin(),
        nixStore: await client.makeNixStore(),
        paths: {
          webApp: await addToStore(join(here, 'kvats', 'webapp.js')),
          storeMaker: await addToStore(join(here, 'kvats', 'store-maker.js')),
          cache: await addToStore(join(here, 'kvats', 'bookmark-cache.js')),
        },
        fetch: await client.makeFetchDevice(),
        ingress: await client.makeIngress({ app: 'bookmarks' }),
        templates: await E(await client.makeGitWorktree()).getTree(
          tree,
          listing,
        ),
      },
    );
    const { cache, admins } = await E(boot).bootstrap(
      `http://${host}/bookmarks/`,
    );
    const page = async () =>
      (await fetch(`http://127.0.0.1:${port}/?app=bookmarks`)).text();
    assert.match(await page(), /<pre>\(none yet\)<\/pre>/);
    assert.equal(await E(cache).refresh(), 'GET /bookmarks/ cookie=none');
    await E(boot).setCookie('session=1');
    assert.equal(await E(cache).refresh(), 'GET /bookmarks/ cookie=session=1');

    for (const admin of [bootAdmin, ...values(admins)])
      await E(admin).restart();
    assert.equal(await E(cache).latest(), 'GET /bookmarks/ cookie=session=1');
    assert.match(
      await page(),
      /<pre>GET \/bookmarks\/ cookie=session=1<\/pre>/,
    );
    await E(boot).setCookie('session=2');
    assert.equal(await E(cache).refresh(), 'GET /bookmarks/ cookie=session=2');

    // here the lan service allows loopback, where this test's site is
    const lan = await client.makeLanDevice();
    assert.deepEqual(
      (({ status, body }) => ({ status, body }))(
        await E(lan).fetch(`http://${host}/models`),
      ),
      { status: 200, body: 'GET /models cookie=none' },
    );

    client.close();
  } finally {
    await box?.server.stop();
    await new Promise(resolve => site.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});
