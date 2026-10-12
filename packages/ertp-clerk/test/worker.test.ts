/**
 * @file The ledger Durable Object in workerd, reached from Node by OCapN
 * over a Cap'n Web WebSocket session.
 * @see ../src/index.ts
 */
import test from 'ava';
import { newWebSocketRpcSession } from 'capnweb';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { connectLedger } from '../src/ledger-ocapn.js';
import type { ByteGateway } from '../src/ocapn-capnweb-netlayer.js';
import {
  aliceSendsBob10Bucks,
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

const startWrangler = async () => {
  const port = await freePort();
  const pkg = createRequire(import.meta.url).resolve('wrangler/package.json');
  const bin = join(dirname(pkg), 'bin', 'wrangler.js');
  const state = await mkdtemp(join(tmpdir(), 'ertp-clerk-'));
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
  return { url: `ws://127.0.0.1:${port}/api`, stop: () => child.kill() };
};

const worker = await startWrangler();
test.after.always(() => worker.stop());

const connect = async (t: import('ava').ExecutionContext) => {
  const { ledger, shutdown } = await connectLedger(() =>
    newWebSocketRpcSession<ByteGateway>(worker.url),
  );
  t.teardown(shutdown);
  return ledger as Ledger;
};

test.serial('alice sends bob 10 BUCKS; brand round-trips', async t => {
  await aliceSendsBob10Bucks(t, await connect(t));
});

test.serial('a spent payment is not live', async t => {
  await spentPaymentIsNotLive(t, await connect(t));
});
