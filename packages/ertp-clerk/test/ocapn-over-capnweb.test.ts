/**
 * @file ERTP over OCapN, with Cap'n Web as the netlayer, in one process.
 * @see ../src/ocapn-capnweb-netlayer.ts
 */
import test from 'ava';
import Database from 'better-sqlite3';
import { newMessagePortRpcSession, RpcSession } from 'capnweb';
import {
  initGnuCashSchema,
  wrapBetterSqlite3Database,
} from '@vattr/ertp-books/src/index.js';
import { mockMakeGuid } from '@vattr/ertp-books/src/guids.js';
import { connectLedger, makeLedgerHost } from '../src/ledger-ocapn.js';
import type { ByteGateway } from '../src/ocapn-capnweb-netlayer.js';
import { makeLedgerBootstrap } from '../src/ledger.js';
import {
  aliceSendsBob10Bucks,
  spentPaymentIsNotLive,
  type Ledger,
} from './scenarios.js';

const makeBootstrap = () => {
  const db = wrapBetterSqlite3Database(new Database(':memory:'));
  initGnuCashSchema(db);
  let now = Date.UTC(2026, 9, 10);
  return makeLedgerBootstrap({
    db,
    makeGuid: mockMakeGuid(),
    nowMs: () => (now += 1000),
  });
};

const enliven = async (t: import('ava').ExecutionContext) => {
  const { port1, port2 } = new MessageChannel();
  const host = await makeLedgerHost(makeBootstrap());
  newMessagePortRpcSession(port1, host.gateway);
  const client = await connectLedger(() =>
    newMessagePortRpcSession<ByteGateway>(port2),
  );
  t.teardown(() => {
    client.shutdown();
    host.shutdown();
    port1.close();
    port2.close();
  });
  return client.ledger as Ledger;
};

test('alice sends bob 10 BUCKS; brand round-trips', async t => {
  await aliceSendsBob10Bucks(t, await enliven(t));
});

test('a spent payment is not live', async t => {
  await spentPaymentIsNotLive(t, await enliven(t));
});

/** A pair of in-memory Cap'n Web transports, for sessions we can inspect. */
const makeTransportPair = () => {
  const makeQueue = () => {
    const items: string[] = [];
    const waiters: ((item: string) => void)[] = [];
    return {
      put: (item: string) => {
        const waiter = waiters.shift();
        if (waiter) waiter(item);
        else items.push(item);
      },
      take: () =>
        items.length
          ? Promise.resolve(items.shift()!)
          : new Promise<string>(resolve => waiters.push(resolve)),
    };
  };
  const [a, b] = [makeQueue(), makeQueue()];
  return [
    { send: async (m: string) => b.put(m), receive: a.take },
    { send: async (m: string) => a.put(m), receive: b.take },
  ] as const;
};

test("Cap'n Web tables stay small as OCapN traffic grows", async t => {
  const [hostEnd, clientEnd] = makeTransportPair();
  const host = await makeLedgerHost(makeBootstrap());
  const hostSession = new RpcSession(hostEnd, host.gateway);
  let clientSession: RpcSession<ByteGateway> | undefined;
  const client = await connectLedger(() => {
    clientSession = new RpcSession<ByteGateway>(clientEnd);
    return clientSession.getRemoteMain();
  });
  t.teardown(() => {
    client.shutdown();
    host.shutdown();
  });

  await aliceSendsBob10Bucks(t, client.ledger as Ledger);
  await Promise.all([hostSession.drain(), clientSession!.drain()]);
  // main + one inbox each way; per-message results are released
  const stats = {
    host: hostSession.getStats(),
    client: clientSession!.getStats(),
  };
  t.log(stats);
  t.true(stats.host.exports <= 3);
  t.true(stats.client.imports <= 3);
});
