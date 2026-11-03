/** @file The wallet boot directory: a hub per client in the browser, counters, issuer kits, and introductions, across a crash and an upgrade. */
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/**
 * A hub as the page sees it.
 *
 * @typedef {{ label: string, names: { name: string, iface: string }[], messages: { id: number, from: string, label: string, count: number }[] }} HubView
 */

/**
 * A client of the wallet's API at `port`, as the page is: `as(hub)` speaks
 * for the hub with that swiss number.
 *
 * @param {() => number} port
 */
const walletAt = port => {
  /** @param {Record<string, unknown>} req */
  const post = async req => {
    const resp = await fetch(`http://127.0.0.1:${port()}/api`, {
      method: 'POST',
      body: JSON.stringify(req),
    });
    const data = await resp.json();
    if (!resp.ok) throw Error(data.error);
    return data;
  };
  return {
    post,
    /** @param {string} hub */
    as: hub => ({
      /** @returns {Promise<HubView>} */
      view: () => post({ hub, op: 'view' }),
      /** @param {string} target @param {string} method @param {unknown[]} [args] @param {string} [saveAs] */
      call: async (target, method, args = [], saveAs = undefined) =>
        (await post({ hub, op: 'call', target, method, args, saveAs })).answer,
      /** @param {string} peer */
      invite: async peer => (await post({ hub, op: 'invite', peer })).invite,
      /** @param {string} to @param {string} label @param {string[]} names */
      send: (to, label, names) => post({ hub, op: 'send', to, label, names }),
      /** @param {number} id @param {number} index @param {string} name */
      adopt: (id, index, name) => post({ hub, op: 'adopt', id, index, name }),
    }),
  };
};

test('alice makes an issuer kit; once introduced, she pays into the purse bob made from the issuer she sent him', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'toybox-wallet-'));
  const boot = join(dir, 'wallet');
  await cp(join(here, 'kvats', 'wallet'), boot, { recursive: true });
  let box = await startToybox(dir, { boot });
  const wallet = walletAt(() => box.appPort);
  try {
    const page = await fetch(`http://127.0.0.1:${box.appPort}/`);
    assert.match(await page.text(), /<script src="\/wallet.js">/);
    assert.match(
      page.headers.get('content-security-policy') ?? '',
      /^default-src 'self';/,
    );
    const script = await fetch(`http://127.0.0.1:${box.appPort}/wallet.js`);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);

    // the operator's link, from the admin socket
    const main = await connectKernel(
      new WebSocket(`ws+unix:${box.sock}:/kernel/main`),
    );
    const [bootVat] = await main.vats();
    const link = await E(bootVat.root).ownerLink();
    main.close();
    const [, aliceHub] = link.match(/^#hub=([0-9a-f]{32})$/) ?? [];
    assert.ok(aliceHub);
    const alice = wallet.as(aliceHub);
    assert.deepEqual((await alice.view()).names.map(n => n.name).sort(), [
      'counters',
      'issuers',
    ]);

    assert.deepEqual(await alice.call('counters', 'makeCounter', [], 'c'), {
      '@name': 'c',
    });
    assert.equal(await alice.call('c', 'incr'), 1);
    await assert.rejects(
      alice.call('counters', 'makeCounter'),
      /name it with saveAs/,
    );
    assert.deepEqual(
      await alice.call('issuers', 'makeIssuerKit', ['Bucks'], 'bucks'),
      {
        mint: { '@name': 'bucks.mint' },
        issuer: { '@name': 'bucks.issuer' },
        brand: { '@name': 'bucks.brand' },
      },
    );

    const invite = await alice.invite('bob');
    const { hub: bobHub, inviter } = await wallet.post({
      op: 'accept',
      invite,
    });
    assert.equal(inviter, 'owner');
    await assert.rejects(
      wallet.post({ op: 'accept', invite }),
      /no such invitation/,
    );
    const bob = wallet.as(bobHub);

    await alice.send('bob', 'my issuer', ['bucks.issuer']);
    assert.deepEqual((await bob.view()).messages, [
      { id: 1, from: 'owner', label: 'my issuer', count: 1 },
    ]);
    await bob.adopt(1, 0, 'bucks');
    await bob.call('bucks', 'makeEmptyPurse', [], 'purse');
    await bob.call('purse', 'getDepositFacet', [], 'purse.deposit');
    await bob.send('owner', 'pay me', ['purse.deposit']);

    const [paid] = (await alice.view()).messages;
    assert.equal(paid.from, 'bob');
    await alice.adopt(paid.id, 0, 'bob.pay');
    await alice.call('bucks.mint', 'mintPayment', [10], 'ten');
    assert.equal(
      await alice.call('bob.pay', 'receive', [{ '@name': 'ten' }]),
      10,
    );
    await assert.rejects(
      alice.call('bob.pay', 'receive', [{ '@name': 'ten' }]),
      /not a live payment/,
    );
    assert.equal(await bob.call('purse', 'getBalance'), 10);
    // bob holds only a deposit facet's worth of alice: he can't name her mint
    await assert.rejects(
      bob.call('bucks.mint', 'mintPayment', [5]),
      /no "bucks.mint" here/,
    );
    await assert.rejects(
      wallet.post({ hub: '0'.repeat(32), op: 'view' }),
      /no such hub/,
    );

    // a crash, and new code for the counters: the boot vat upgrades them
    await box.server.stop();
    const counters = join(boot, 'counters.js');
    await writeFile(
      counters,
      (await readFile(counters, 'utf8')).replace(
        '      read() {',
        '      decr() {\n        this.state.count -= 1;\n        return this.state.count;\n      },\n      read() {',
      ),
    );
    box = await startToybox(dir, { boot });
    assert.equal(await alice.call('c', 'incr'), 2);
    assert.equal(await alice.call('c', 'decr'), 1);
    assert.equal(await bob.call('purse', 'getBalance'), 10);
  } finally {
    await box.server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
