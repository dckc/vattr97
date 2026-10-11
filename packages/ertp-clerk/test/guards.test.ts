/**
 * @file Hostile arguments that the ledger lets through, because its
 * objects are plain `Far` objects without interface guards. Calls go
 * over OCapN, so the arguments are only what a remote party can send:
 * passable data and its own remotables.
 *
 * Each test is `test.failing`, since each shows a missing guard; once
 * guards (`M.interface`, `makeExo`) are in place, drop `.failing`.
 */
import test from 'ava';
import { E, Far } from '@endo/far';
import Database from 'better-sqlite3';
import { newMessagePortRpcSession } from 'capnweb';
import {
  initGnuCashSchema,
  wrapBetterSqlite3Database,
} from '@vattr/ertp-books/src/index.js';
import { mockMakeGuid } from '@vattr/ertp-books/src/guids.js';
import { connectLedger, makeLedgerHost } from '../src/ledger-ocapn.js';
import type { ByteGateway } from '../src/ocapn-capnweb-netlayer.js';
import { makeLedger } from '../src/ledger.js';

/** a ledger over OCapN, and a count of the rows in each of its tables */
const start = async (t: import('ava').ExecutionContext) => {
  const raw = new Database(':memory:');
  const db = wrapBetterSqlite3Database(raw);
  initGnuCashSchema(db);
  let now = Date.UTC(2026, 9, 10);
  let swissCount = 0;
  const { swissnumTable } = makeLedger({
    db,
    makeGuid: mockMakeGuid(),
    nowMs: () => (now += 1000),
    makeSwissnum: () => `swiss${(swissCount += 1)}`,
  });
  const { port1, port2 } = new MessageChannel();
  const host = await makeLedgerHost(swissnumTable);
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
  const rowCounts = () =>
    Object.fromEntries(
      raw
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table'`,
        )
        .all()
        .map(({ name }) => [
          name,
          raw.prepare(`SELECT count(*) AS n FROM "${name}"`).get(),
        ]),
    );
  return { ledger: client.ledger, rowCounts };
};

test.failing('a rejected makeEscrow leaves no trace', async t => {
  const { ledger, rowCounts } = await start(t);
  const { brand } = await E(ledger).makeIssuerKit('USDC');
  const before = rowCounts();
  await t.throwsAsync(
    () =>
      E(ledger).makeEscrow(
        harden({ brand, value: 1n }),
        harden({ brand: Far('fake brand', {}), value: 1n }),
      ),
    { message: /not a brand of this ledger/ },
  );
  // makeEscrow checks each side as it goes, so side a's holding account
  // is already made when side b is refused. A guard checks both first.
  t.deepEqual(rowCounts(), before);
});

test.failing('makeIssuerKit takes only a string', async t => {
  const { ledger, rowCounts } = await start(t);
  const before = rowCounts();
  for (const mnemonic of [42, 1n]) {
    await t.throwsAsync(() => E(ledger).makeIssuerKit(mnemonic as never));
  }
  t.deepEqual(rowCounts(), before);
});

test.failing('getAmountOf refuses a non-payment', async t => {
  const { ledger } = await start(t);
  const { issuer } = await E(ledger).makeIssuerKit('USDC');
  // ERTP's IssuerI guards getAmountOf with PaymentShape; this issuer
  // answers that 'x' is worth 0 USDC
  await t.throwsAsync(() => E(issuer).getAmountOf('x' as never));
});
