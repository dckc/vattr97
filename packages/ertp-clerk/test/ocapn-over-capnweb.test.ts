/**
 * @file ERTP over OCapN, with Cap'n Web as the netlayer, in one process.
 * @see ../src/ocapn-capnweb-netlayer.ts
 */
import test from 'ava';
import { E } from '@endo/far';
import Database from 'better-sqlite3';
import { newMessagePortRpcSession, RpcSession } from 'capnweb';
import {
  initGnuCashSchema,
  wrapBetterSqlite3Database,
} from '@vattr/ertp-books/src/index.js';
import { mockMakeGuid } from '@vattr/ertp-books/src/guids.js';
import { connectLedger, makeLedgerHost } from '../src/ledger-ocapn.js';
import type { ByteGateway } from '../src/ocapn-capnweb-netlayer.js';
import { makeLedger } from '../src/ledger.js';
import {
  aliceSendsBob10Bucks,
  spentPaymentIsNotLive,
  type Ledger,
} from './scenarios.js';

const makeDb = () => {
  const db = wrapBetterSqlite3Database(new Database(':memory:'));
  initGnuCashSchema(db);
  return db;
};

const makeIO = () => {
  let now = Date.UTC(2026, 9, 10);
  let swissCount = 0;
  return {
    makeGuid: mockMakeGuid(),
    nowMs: () => (now += 1000),
    makeSwissnum: () => `swiss${(swissCount += 1)}`,
  };
};

const makeSwissnumTable = (db = makeDb(), io = makeIO()) =>
  makeLedger({ db, ...io }).swissnumTable;

const enliven = async (t: import('ava').ExecutionContext) => {
  const { port1, port2 } = new MessageChannel();
  const host = await makeLedgerHost(makeSwissnumTable());
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
  const host = await makeLedgerHost(makeSwissnumTable());
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

test('purse and mint sturdyrefs survive a ledger restart', async t => {
  const db = makeDb();
  const io = makeIO();
  /** one incarnation of the ledger over `db`, and a client of it */
  const start = async () => {
    const { port1, port2 } = new MessageChannel();
    const host = await makeLedgerHost(makeSwissnumTable(db, io));
    newMessagePortRpcSession(port1, host.gateway);
    const client = await connectLedger(() =>
      newMessagePortRpcSession<ByteGateway>(port2),
    );
    return {
      client,
      stop: () => {
        client.shutdown();
        host.shutdown();
        port1.close();
        port2.close();
      },
    };
  };

  const one = await start();
  const { ledger } = one.client;
  const { issuer, brand, mint } = await E(ledger).makeIssuerKit('BUCKS');
  const alice = await E(issuer).makeEmptyPurse();
  await E(alice).deposit(
    await E(mint).mintPayment(harden({ brand, value: 10n })),
  );
  const aliceSwiss = await E(ledger).makeSturdyRef(alice);
  const mintSwiss = await E(ledger).makeSturdyRef(mint);
  t.is(await E(ledger).makeSturdyRef(alice), aliceSwiss, 'one per object');
  t.is(await one.client.enliven(aliceSwiss), alice, 'same live purse');
  one.stop();

  const two = await start();
  t.teardown(two.stop);
  const alice2 = await two.client.enliven(aliceSwiss);
  const mint2 = await two.client.enliven(mintSwiss);
  const brand2 = await E(E(mint2).getIssuer()).getBrand();
  const balance = await E(alice2).getCurrentAmount();
  t.is(balance.value, 10n);
  t.is(balance.brand, brand2, 'revived purse and mint share a brand');

  const more = await E(mint2).mintPayment(harden({ brand: brand2, value: 5n }));
  await E(alice2).deposit(more);
  t.is((await E(alice2).getCurrentAmount()).value, 15n);
});
