/**
 * @file The ledger Durable Object in workerd, reached from Node by OCapN
 * over a Cap'n Web WebSocket session.
 * @see ../src/index.ts
 */
import test from 'ava';
import { E } from '@endo/far';
import { newWebSocketRpcSession } from 'capnweb';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { connectLedger, makeLedgerClient } from '../src/ledger-ocapn.js';
import type { ByteGateway } from '../src/ocapn-capnweb-netlayer.js';
import {
  aliceBuysStockFromBob,
  aliceSendsBob10Bucks,
  escrowOutlivesRestart,
  escrowSwapsUsdcForStock,
  spentPaymentIsNotLive,
  type Ledger,
} from './scenarios.js';

// wrangler can't share a process with SES lockdown, so it runs in a child.
const freePort = async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as import('node:net').AddressInfo;
  server.close();
  return port;
};

/** @param state - where Durable Object storage persists */
const startWrangler = async (state: string) => {
  const port = await freePort();
  const pkg = createRequire(import.meta.url).resolve('wrangler/package.json');
  const bin = join(dirname(pkg), 'bin', 'wrangler.js');
  const child = spawn(
    process.execPath,
    [
      bin,
      'dev',
      '--ip',
      '127.0.0.1',
      '--port',
      `${port}`,
      '--persist-to',
      state,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  let output = '';
  for await (const chunk of child.stdout) {
    output += chunk;
    if (output.includes('Ready on')) break;
  }
  if (!output.includes('Ready on')) {
    throw Error(`wrangler dev exited before ready:\n${output}`);
  }
  child.stdout.resume();
  const origin = `ws://127.0.0.1:${port}`;
  const url = `${origin}/api`;
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill();
    await once(child, 'exit');
  };
  return { origin, url, stop };
};

const makeState = () => mkdtemp(join(tmpdir(), 'ertp-clerk-'));
const worker = await startWrangler(await makeState());
test.after.always(() => worker.stop());

const connectTo = async (
  t: import('ava').ExecutionContext,
  url = worker.url,
) => {
  const client = await connectLedger(() =>
    newWebSocketRpcSession<ByteGateway>(url),
  );
  t.teardown(client.shutdown);
  return client;
};
const connect = async (t: import('ava').ExecutionContext) =>
  (await connectTo(t)).ledger as Ledger;

test.serial('alice sends bob 10 BUCKS; brand round-trips', async t => {
  await aliceSendsBob10Bucks(t, await connect(t));
});

test.serial('a spent payment is not live', async t => {
  await spentPaymentIsNotLive(t, await connect(t));
});

test.serial('escrow swaps USDC for STOCK, or refunds', async t => {
  await escrowSwapsUsdcForStock(t, await connect(t));
});

test.serial('an escrow outlives restarting workerd', async t => {
  const state = await makeState();
  await escrowOutlivesRestart(t, async () => {
    const wrangler = await startWrangler(state);
    t.teardown(wrangler.stop);
    const client = await connectTo(t, wrangler.url);
    return { ...client, stop: wrangler.stop };
  });
});

/** @param origins - where each ledger, by name, is served */
const makeClient = async (
  t: import('ava').ExecutionContext,
  origins: Record<string, string>,
) => {
  const client = await makeLedgerClient(name =>
    newWebSocketRpcSession<ByteGateway>(`${origins[name]}/api/${name}`),
  );
  t.teardown(client.shutdown);
  return client;
};

test.serial('USDC and STOCK in separate Durable Objects', async t => {
  const { origin } = worker;
  const client = await makeClient(t, { usdc: origin, stock: origin });
  await aliceBuysStockFromBob(
    t,
    (await client.ledger('usdc')) as Ledger,
    (await client.ledger('stock')) as Ledger,
  );
});

test.serial('USDC and STOCK in separate workerd processes', async t => {
  // one at a time: concurrent `wrangler dev` startups crash
  const usdcWorker = await startWrangler(await makeState());
  t.teardown(usdcWorker.stop);
  const stockWorker = await startWrangler(await makeState());
  t.teardown(stockWorker.stop);
  const client = await makeClient(t, {
    usdc: usdcWorker.origin,
    stock: stockWorker.origin,
  });
  await aliceBuysStockFromBob(
    t,
    (await client.ledger('usdc')) as Ledger,
    (await client.ledger('stock')) as Ledger,
  );
});

test.serial(
  'purse and payment sturdyrefs survive restarting workerd',
  async t => {
    const state = await makeState();
    const first = await startWrangler(state);
    t.teardown(first.stop);
    const { ledger } = await connectTo(t, first.url);
    const { issuer, brand, mint } = await E(ledger).makeIssuerKit('BUCKS');
    const alice = await E(issuer).makeEmptyPurse();
    await E(alice).deposit(
      await E(mint).mintPayment(harden({ brand, value: 10n })),
    );
    const payment = await E(alice).withdraw(harden({ brand, value: 4n }));
    const aliceSwiss = await E(ledger).makeSturdyRef(alice);
    const paymentSwiss = await E(ledger).makeSturdyRef(payment);
    await first.stop();

    const second = await startWrangler(state);
    t.teardown(second.stop);
    const client = await connectTo(t, second.url);
    const alice2 = await client.enliven(aliceSwiss);
    const balance = await E(alice2).getCurrentAmount();
    t.is(balance.value, 6n);
    t.is(await E(balance.brand).getAllegedName(), 'BUCKS');
    await E(alice2).deposit(await client.enliven(paymentSwiss));
    t.is((await E(alice2).getCurrentAmount()).value, 10n);
    await t.throwsAsync(() => client.enliven(paymentSwiss), {
      message: /payment not live/,
    });
  },
);
