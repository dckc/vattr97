/**
 * @file ERTP over CapTP, with Cap'n Web as the netlayer, in one process.
 * @see ../src/captp-over-capnweb.ts
 */
import test from 'ava';
import Database from 'better-sqlite3';
import { newMessagePortRpcSession, RpcSession } from 'capnweb';
import {
  initGnuCashSchema,
  wrapBetterSqlite3Database,
} from '@vattr/ertp-books/src/index.js';
import { mockMakeGuid } from '@vattr/ertp-books/src/guids.js';
import { connectCapTP, Gateway } from '../src/captp-over-capnweb.js';
import { makeLedgerBootstrap } from '../src/ledger.js';
import {
  aliceSendsBob10Bucks,
  spentPaymentIsNotLive,
  type Ledger,
} from './scenarios.js';

const makeHostAndClient = (t: import('ava').ExecutionContext) => {
  const db = wrapBetterSqlite3Database(new Database(':memory:'));
  initGnuCashSchema(db);
  let now = Date.UTC(2026, 9, 10);
  const bootstrap = makeLedgerBootstrap({
    db,
    makeGuid: mockMakeGuid(),
    nowMs: () => (now += 1000),
  });

  const { port1, port2 } = new MessageChannel();
  newMessagePortRpcSession(port1, new Gateway('host', bootstrap, t.log));
  const gateway = newMessagePortRpcSession<Gateway>(port2);
  const client = connectCapTP(gateway as any, 'client');
  t.teardown(() => {
    port1.close();
    port2.close();
  });
  return client.getBootstrap() as Promise<Ledger>;
};

test('alice sends bob 10 BUCKS; brand round-trips', async t => {
  await aliceSendsBob10Bucks(t, await makeHostAndClient(t));
});

test('a spent payment is not live', async t => {
  await spentPaymentIsNotLive(t, await makeHostAndClient(t));
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

test("Cap'n Web tables stay small as CapTP traffic grows", async t => {
  const db = wrapBetterSqlite3Database(new Database(':memory:'));
  initGnuCashSchema(db);
  let now = Date.UTC(2026, 9, 10);
  const bootstrap = makeLedgerBootstrap({
    db,
    makeGuid: mockMakeGuid(),
    nowMs: () => (now += 1000),
  });
  const [hostEnd, clientEnd] = makeTransportPair();
  const host = new RpcSession(hostEnd, new Gateway('host', bootstrap, t.log));
  const client = new RpcSession<Gateway>(clientEnd);
  const { getBootstrap } = connectCapTP(
    client.getRemoteMain() as any,
    'client',
  );

  await aliceSendsBob10Bucks(t, (await getBootstrap()) as Ledger);
  await Promise.all([host.drain(), client.drain()]);
  // main + one inbox each way; per-message results are released
  t.log({ host: host.getStats(), client: client.getStats() });
  t.true(host.getStats().exports <= 3);
  t.true(client.getStats().imports <= 3);
});
