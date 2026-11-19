/** @file The wallet boot directory: hosts, counters, issuer kits, and introductions, across a crash and an upgrade. */
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
import { assert as check } from '@endo/errors';
import { E } from '@endo/far';
import workerdPackage from 'workerd';
import WebSocket from 'ws';
import { makeTree } from '../src/dir-tree.js';
import { makeToyboxes } from '../src/toyboxes.js';
import { makeWorkerd } from '../src/workerd-process.js';
import { isSwissNum } from '../examples/wallet/gateway/registry.exo.js';

/**
 * @import { Remote, SwissNum } from '../src/types.js';
 * @import { WalletBoot } from '../examples/wallet/boot.js';
 * @import { TestContext } from 'node:test';
 * @import { Tree } from '../src/dir-tree.js';
 */

/**
 * Node's I/O, as this test's helpers use it: the test is the edge, and
 * each test takes what it hands on from here.
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

/** @typedef {Awaited<ReturnType<WalletBoot['agents']>>} Agents the agents, by the swiss numbers in their links */
/** @typedef {ReturnType<Agents['deref']>} AgentFacets an agent, as its link designates it */

/** @typedef {Extract<AgentFacets, { host: unknown }>} HostAgent a host, as its link designates it */

/**
 * The host `agent` is, or a rejection if it's a guest.
 *
 * @param {Promise<AgentFacets>} agent
 * @returns {Promise<HostAgent>}
 */
const asHost = async agent => {
  const it = await agent;
  if (!('host' in it)) throw Error('this link is no host');
  return it;
};

/** @typedef {(req: Record<string, unknown>) => Promise<Record<string, unknown>>} OnPage the page's API, as one agent's link reaches it */

/** @typedef {Awaited<ReturnType<World['startToybox']>>} Toybox */

/**
 * The page's API on the app socket `app`: POST a request, get its JSON
 * answer.
 *
 * @param {Toybox['app']} app
 * @param {Record<string, unknown>} req
 * @returns {Promise<Record<string, unknown>>}
 */
const postToPage = async (app, req) => {
  const resp = await app('/api', {
    method: 'POST',
    body: JSON.stringify(req),
  });
  /** @type {unknown} */
  const data = await resp.json();
  if (typeof data !== 'object' || data === null)
    throw Error(`not a JSON object: ${JSON.stringify(data)}`);
  const answer = Object.fromEntries(Object.entries(data));
  if (!resp.ok) {
    const { error } = answer;
    check.typeof(error, 'string');
    throw Error(error);
  }
  return answer;
};

/**
 * A copy of examples/ in `dir`, for a test to change: the wallet's source
 * directory, with its boot directory, `wallet`, in it.
 *
 * @param {Pick<World, 'pkg'>} io
 * @param {Tree} dir
 */
const copyExamples = async ({ pkg }, dir) => {
  await pkg.copy('examples', dir, 'examples');
  const examples = dir.sub('examples');
  return { examples, source: examples, boot: examples.sub('wallet') };
};

/**
 * The operator of a running toybox: the boot vat's root, from a session on
 * the admin socket, once a request to the app socket has started it. Its
 * references last as long as the session.
 *
 * @param {Pick<Toybox, 'app' | 'admin'>} box
 */
const operate = async ({ app, admin }) => {
  await (await app('/')).text();
  const main = await admin();
  const [bootVat] = await main.vats();
  // the kernel's first vat is the boot vat; the client can't know its type
  /** @type {Remote<WalletBoot>} */
  const boot = bootVat.root;
  return { boot, close: main.close };
};

/**
 * A remote async iterator, as `for await` takes it, after endo's.
 *
 * @template T
 * @param {Promise<{ next: () => Promise<IteratorResult<T, undefined>>, return: () => IteratorReturnResult<undefined> }>} ref
 * @returns {AsyncIterable<T, undefined>}
 */
const makeRefIterator = ref =>
  harden({
    [Symbol.asyncIterator]: () =>
      harden({
        next: () => E(ref).next(),
        return: () => E(ref).return(),
      }),
  });

/**
 * The swiss number in an agent's link.
 *
 * @param {string} link
 */
const swissOf = link => {
  const [, swiss] = link.match(/^#agent=(.*)$/) ?? [];
  if (!isSwissNum(swiss)) throw Error(`not an agent's link: ${link}`);
  return swiss;
};

/**
 * Alice, the wallet's owner, who mints Bucks and pays bob in them. She
 * keeps her link, as her browser does; everything else she keeps in her
 * names.
 *
 * @param {{ me: Promise<HostAgent>, onPage: OnPage, bob: Pick<Bob, 'accept'>, t: TestContext }} powers
 */
const makeAlice = ({ me, onPage, bob, t }) => {
  /** @type {TestContext['assert']} assertion signatures need a declared type */
  const tAssert = t.assert;
  const { nameHub, nameAdmin, host } = E.get(me);

  /** Make a counter on the page, as she would in her browser; count once. */
  const countOnPage = async () => {
    // an answer that holds a reference has to be named
    await tAssert.rejects(
      onPage({ op: 'call', target: 'counters', method: 'makeCounter' }),
      /name it with saveAs/,
    );
    const made = await onPage({
      op: 'call',
      target: 'counters',
      method: 'makeCounter',
      saveAs: 'c',
    });
    tAssert.deepStrictEqual(made.answer, { '@name': 'c' });
    const { label, kind, names, messages } = await onPage({ op: 'view' });
    tAssert.strictEqual(label, 'owner');
    tAssert.strictEqual(kind, 'host');
    // each reference is shown with the interface its vat alleges
    tAssert.ok(
      Array.isArray(names) &&
        names.some(n => n.name === 'c' && n.iface === 'Counter'),
    );
    tAssert.deepStrictEqual(messages, []);
    const { answer } = await onPage({
      op: 'call',
      target: 'c',
      method: 'incr',
    });
    tAssert.strictEqual(answer, 1);
  };

  /** Mint Bucks: an issuer kit, kept in her names. */
  const startBucks = async () => {
    const { mint, issuer, brand } = await E(
      E(nameHub).lookup('issuers'),
    ).makeIssuerKit('Bucks');
    await E(nameAdmin).update('bucks.mint', mint);
    await E(nameAdmin).update('bucks.issuer', issuer);
    await E(nameAdmin).update('bucks.brand', brand);
  };

  /**
   * An invitation for someone she'll know as `name`, by its swiss number,
   * for her to hand them.
   *
   * @param {string} name
   */
  const invite = async name => {
    const { invite: swiss } = await onPage({ op: 'invite', peer: name });
    if (!isSwissNum(swiss)) throw Error(`not an invitation: ${swiss}`);
    return swiss;
  };

  /**
   * Read her mail as it comes: pay 10 Bucks to whoever asks to be paid,
   * once, and tell them so. A payment spends once.
   */
  const payWhenAsked = async () => {
    for await (const message of makeRefIterator(E(host).followMessages())) {
      const { from } = message;
      if (
        message.type !== 'package' ||
        !from ||
        message.strings[0] !== 'pay me'
      )
        continue;
      const payee = `${from}.pay`;
      await E(host).adopt(message.number, 'deposit', payee);
      const payment = await E(E(nameHub).lookup('bucks.mint')).mintPayment(10);
      await E(E(nameHub).lookup(payee)).receive(payment);
      await tAssert.rejects(
        E(E(nameHub).lookup(payee)).receive(payment),
        /not a live payment/,
      );
      return E(host).send(from, ['paid'], [], []);
    }
    throw Error('her mail ended before anyone asked to be paid');
  };

  return harden({
    /** Count, mint Bucks, invite bob, send him her issuer, and pay him. */
    async run() {
      tAssert.deepStrictEqual([...(await E(nameHub).keys())].sort(), [
        'counters',
        'issuers',
      ]);
      await countOnPage();
      await startBucks();

      // an invitation is for one use, and one that fails stays open, to fail again
      const nameless = await invite('');
      for (let tries = 0; tries < 2; tries += 1)
        await tAssert.rejects(bob.accept(nameless), /a name, please/);

      await bob.accept(await invite('bob'));
      await E(host).send('bob', ['my issuer'], ['issuer'], ['bucks.issuer']);
      await payWhenAsked();
    },
    /** After an upgrade that adds `decr`, count on from where she was. */
    async countOn() {
      const c = E(nameHub).lookup('c');
      tAssert.strictEqual(await E(c).incr(), 2);
      tAssert.strictEqual(await E(c).decr(), 1);
    },
  });
};

/**
 * Bob: invited by alice, he accepts, and, given an issuer, makes a purse
 * for it and asks to be paid into it. His browser keeps his link, once he
 * has one.
 *
 * @param {{ invites: ReturnType<WalletBoot['invites']>, openLink: (swiss: SwissNum) => Promise<HostAgent>, link?: SwissNum, t: TestContext }} powers
 */
const makeBob = ({ invites, openLink, link, t }) => {
  /** @type {TestContext['assert']} assertion signatures need a declared type */
  const tAssert = t.assert;
  /** @type {PromiseWithResolvers<SwissNum>} */
  const linked = Promise.withResolvers();
  if (link) linked.resolve(link);
  const me = E.get(linked.promise.then(openLink));

  /** His balance: the 10 Bucks he was paid. */
  const checkBalance = async () =>
    tAssert.strictEqual(
      await E(E(me.nameHub).lookup('purse')).getBalance(),
      10,
    );

  /** Read his mail as it comes: ask to be paid for an issuer, until he's paid. */
  const readMail = async () => {
    const { nameHub, nameAdmin, host } = me;
    for await (const message of makeRefIterator(E(host).followMessages())) {
      if (message.type !== 'package') continue;
      if (message.strings[0] === 'my issuer') {
        tAssert.deepStrictEqual(message.names, ['issuer']);
        await E(host).adopt(message.number, 'issuer', 'bucks');
        const purse = await E(E(nameHub).lookup('bucks')).makeEmptyPurse();
        await E(nameAdmin).update('purse', purse);
        await E(nameAdmin).update('deposit', await E(purse).getDepositFacet());
        await E(host).send('owner', ['pay me'], ['deposit'], ['deposit']);
      }
      if (message.strings[0] !== 'paid') continue;
      await checkBalance();
      // he holds only what he was given of alice's: no mint
      tAssert.deepStrictEqual([...(await E(nameHub).keys())].sort(), [
        'bucks',
        'counters',
        'deposit',
        'issuers',
        'owner',
        'purse',
      ]);
      return;
    }
    throw Error('his mail ended before he was paid');
  };

  /** @type {PromiseWithResolvers<void>} once he's paid, and checked */
  const paid = Promise.withResolvers();

  return harden({
    /**
     * Accept an invitation, as a new host, and read his mail.
     *
     * @param {SwissNum} invite
     */
    async accept(invite) {
      const { host, inviter } = await E(invites).accept(invite);
      tAssert.strictEqual(inviter, 'owner');
      linked.resolve(host);
      readMail().then(paid.resolve, paid.reject);
    },
    paid: () => paid.promise,
    link: () => linked.promise,
    checkBalance,
  });
};

/** @typedef {ReturnType<typeof makeBob>} Bob */

test('alice makes an issuer kit; once introduced, she pays into the purse bob made from the issuer she sent him', async t => {
  const { startToybox, pkg, makeDir } = await worldP;
  const dir = await makeDir('toybox-wallet-');
  t.after(dir.remove);
  const { examples, source, boot } = await copyExamples({ pkg }, dir);
  /** @type {{ alice: SwissNum, bob: SwissNum }} what their browsers keep */
  let links;
  await t.test('alice pays bob', async t => {
    const box = await startToybox(dir, { boot, source });
    t.after(box.stop);
    const operator = await operate(box);
    t.after(operator.close);
    const agents = E(operator.boot).agents();
    const home = await box.app('/');
    assert.match(await home.text(), /<script src="\/wallet.js">/);
    assert.match(
      home.headers.get('content-security-policy') ?? '',
      /^default-src 'self';/,
    );
    const script = await box.app('/wallet.js');
    assert.match(script.headers.get('content-type') ?? '', /javascript/);
    // swiss numbers that name no agent
    for (const agent of ['0'.repeat(32), 'A'.repeat(22)]) {
      await assert.rejects(
        postToPage(box.app, { agent, op: 'view' }),
        /no such agent/,
      );
      // @ts-expect-error a string, not a SwissNum
      await assert.rejects(E(agents).deref(agent), /no such agent/);
    }

    const alice = swissOf(await E(operator.boot).provideOwnerLink());
    const bob = makeBob({
      invites: E(operator.boot).invites(),
      openLink: swiss => asHost(E(agents).deref(swiss)),
      t,
    });
    await Promise.all([
      makeAlice({
        me: asHost(E(agents).deref(alice)),
        onPage: req => postToPage(box.app, { agent: alice, ...req }),
        bob,
        t,
      }).run(),
      bob.paid(),
    ]);
    links = { alice, bob: await bob.link() };
  });

  // a crash, and new code for the counters: the boot vat upgrades them
  const addDecr = (/** @type {string} */ src) =>
    src.replace(
      '      read() {',
      '      decr() {\n        this.state.count -= 1;\n        return this.state.count;\n      },\n      read() {',
    );
  const counters = 'wallet/counters.js';
  await examples.writeText(
    counters,
    addDecr(await examples.readText(counters)),
  );
  await t.test('after a crash, and new code for the counters', async t => {
    const box = await startToybox(dir, { boot, source });
    t.after(box.stop);
    const operator = await operate(box);
    t.after(operator.close);
    const agents = E(operator.boot).agents();
    const bob = makeBob({
      invites: E(operator.boot).invites(),
      openLink: swiss => asHost(E(agents).deref(swiss)),
      link: links.bob,
      t,
    });
    const alice = makeAlice({
      me: asHost(E(agents).deref(links.alice)),
      onPage: req => postToPage(box.app, { agent: links.alice, ...req }),
      bob,
      t,
    });
    await alice.countOn();
    await bob.checkBalance();
  });
});
