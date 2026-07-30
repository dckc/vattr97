#!/usr/bin/env -S node --import ts-blank-space/register
import '@endo/init';

import { decodeBase64 } from '@endo/base64';
import bundleSource from '@endo/bundle-source';
import { makeCancelKit } from '@endo/cancel';
import { makeEndoClient, start } from '@endo/daemon';
import { E } from '@endo/eventual-send';
import { bytesReaderFromIterator } from '@endo/exo-stream/bytes-reader-from-iterator.js';
import { whereEndoSock } from '@endo/where';
import { makeErtpEscrow } from '@finquick/ertp-dacct';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';

const usage = `Usage: npm run test:integration

Environment:
  DB_PATH  database path (default: ./escrow.sqlite)`;

const sqliteModule = new URL(
  '../../sqlite-plugin/src/sqlite-db.js',
  import.meta.url,
).href;
const clockModule = new URL('devices/clock.js', import.meta.url).href;
const ledgerModule = new URL('guests/ledger.js', import.meta.url).href;
const traderModule = new URL('guests/trader.js', import.meta.url).href;
const lit = x => JSON.stringify(x);

const connectEndo = async ({
  env,
  makeClient,
  onSignal,
  platform,
  startDaemon,
  tmpdir,
  userInfo,
}) => {
  const { cancelled, cancel } = makeCancelKit();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGQUIT']) {
    onSignal(signal, () => cancel(Error(signal)));
  }

  const { username, homedir } = userInfo();
  const sockPath = whereEndoSock(platform, env, {
    user: username,
    home: homedir,
    temp: tmpdir(),
  });
  const connect = () =>
    makeClient(
      'ertp-dacct-escrow-integration',
      sockPath,
      cancelled,
      undefined,
      harden({ onReject: () => {} }),
    );

  let client;
  try {
    client = await connect();
  } catch {
    await startDaemon().catch(() => {});
    client = await connect();
  }

  return harden({
    host: E(client.getBootstrap()).host(),
    closeClient: async () => {
      cancel(Error('normal termination'));
      await client.closed.catch(() => {});
    },
  });
};

const provideGuest = async (agent, role) => {
  const agentName = `${role}-agent`;
  await E(agent).provideGuest(`${role}-handle`, { agentName });
  return agentName;
};

const endoMake = async ({ agent, moduleLocation, archiveName, caplets }) => {
  const bundle = await bundleSource(url.fileURLToPath(moduleLocation), {
    format: 'endoZipBase64',
  });
  const archiveBytes = decodeBase64(bundle.endoZipBase64);
  let stored = false;
  try {
    await E(agent).storeBlob(
      bytesReaderFromIterator([archiveBytes]),
      archiveName,
    );
    stored = true;
    return await Promise.all(
      caplets.map(({ workerName, options }) =>
        E(agent).makeArchive(workerName, archiveName, harden(options)),
      ),
    );
  } finally {
    if (stored) {
      await E(agent)
        .remove(archiveName)
        .catch(() => {});
    }
  }
};

const setupLedger = async ({ host, databasePath, archiveNonce }) => {
  const dbName = 'escrow-sqlite-db';
  const clockName = 'escrow-clock';
  await Promise.all([
    E(host).makeUnconfined('@node', sqliteModule, {
      powersName: ['@none'],
      resultName: dbName,
      env: { DB_PATH: databasePath },
    }),
    E(host).makeUnconfined('@node', clockModule, {
      powersName: ['@none'],
      resultName: clockName,
    }),
  ]);

  const ledgerAgent = await provideGuest(host, 'ledger');
  await E(host).move([dbName], [ledgerAgent, 'sqlite-db']);
  await E(host).move([clockName], [ledgerAgent, 'clock']);
  const ledgerWorker = 'ledger-worker';
  const ledgerName = 'ledger';
  await E(host).provideWorker(ledgerWorker);
  const [ledger] = await endoMake({
    agent: host,
    moduleLocation: ledgerModule,
    archiveName: `tmp-ledger-archive-${archiveNonce}`,
    caplets: [
      {
        workerName: ledgerWorker,
        options: {
          powersName: ledgerAgent,
          resultName: ledgerName,
          env: { GUID_START: '0' },
        },
      },
    ],
  });
  await E(host).remove(ledgerAgent);

  const moneyKitName = 'escrow-money-kit';
  const stockKitName = 'escrow-stock-kit';
  const moneyKit = await E(host).evaluate(
    ledgerWorker,
    "E(ledger).makeCurrencyIssuerKit({ mnemonic: 'USD' })",
    ['ledger'],
    [ledgerName],
    moneyKitName,
  );
  const stockKit = await E(host).evaluate(
    ledgerWorker,
    "E(ledger).makeCommodityIssuerKit({ mnemonic: 'STOCK' })",
    ['ledger'],
    [ledgerName],
    stockKitName,
  );
  return harden({
    ledgerWorker,
    mintAccountNames: [
      ...moneyKit.mintAccountNames,
      ...stockKit.mintAccountNames,
    ],
    money: harden({
      brand: moneyKit.brand,
      kitName: moneyKitName,
      issuer: moneyKit.issuer,
    }),
    stock: harden({
      brand: stockKit.brand,
      kitName: stockKitName,
      issuer: stockKit.issuer,
    }),
  });
};

export const main = async (
  argv = process.argv,
  env = process.env,
  {
    makeClient = makeEndoClient,
    cwd = process.cwd,
    onSignal = process.once.bind(process),
    platform = process.platform,
    randomBytes = crypto.randomBytes,
    startDaemon = start,
    stdout = process.stdout,
    tmpdir = os.tmpdir,
    userInfo = os.userInfo,
  } = {},
) => {
  if (argv.slice(2).some(arg => arg === '--help' || arg === '-h')) {
    stdout.write(`${usage}\n`);
    return undefined;
  }

  const runId = randomBytes(8).toString('hex');
  const databasePath = env.DB_PATH ?? path.join(cwd(), 'escrow.sqlite');
  const narrate = (speaker, message) =>
    stdout.write(`${speaker}: ${message}\n`);
  const relay = ({ speaker, message }) => narrate(speaker, message);

  const { host, closeClient } = await connectEndo({
    env,
    makeClient,
    onSignal,
    platform,
    startDaemon,
    tmpdir,
    userInfo,
  });

  try {
    const { ledgerWorker, mintAccountNames, money, stock } = await setupLedger({
      host,
      databasePath,
      archiveNonce: runId,
    });
    const brandNames = new Map([
      [money.brand, 'USD'],
      [stock.brand, 'STOCK'],
    ]);
    const fmtAmt = ({ brand, value }) => {
      const name = brandNames.get(brand);
      assert(name, 'unknown brand');
      return `${value} ${name}`;
    };
    narrate(
      'Ledger',
      `Opened ${databasePath} and placed ${mintAccountNames.join(', ')}.`,
    );

    const traderSpecs = harden({
      alice: harden({
        name: 'Alice',
        give: harden({
          accountName: 'USD',
          kitName: money.kitName,
          value: 100n,
        }),
        want: harden({
          accountName: 'STOCK',
          kitName: stock.kitName,
          value: 10n,
        }),
      }),
      bob: harden({
        name: 'Bob',
        give: harden({
          accountName: 'STOCK',
          kitName: stock.kitName,
          value: 10n,
        }),
        want: harden({
          accountName: 'USD',
          kitName: money.kitName,
          value: 100n,
        }),
      }),
    });
    const traders = await Promise.all(
      Object.entries(traderSpecs).map(async ([id, { name, give, want }]) => {
        const agentName = await provideGuest(host, id);
        return harden({
          id,
          name,
          give,
          want,
          agentName,
          workerName: undefined,
          options: harden({
            powersName: agentName,
            resultName: id,
            env: harden({ TRADER_NAME: name }),
          }),
        });
      }),
    );
    const [alice, bob] = await endoMake({
      agent: host,
      moduleLocation: traderModule,
      archiveName: `tmp-trader-archive-${runId}`,
      caplets: traders.map(({ workerName, options }) =>
        harden({ workerName, options }),
      ),
    });
    await Promise.all(
      Object.keys(traderSpecs).map(id => E(host).remove(`${id}-agent`)),
    );

    const [aliceOffer, bobOffer] = await Promise.all(
      traders.map(({ id, name, give, want }) =>
        E(host).evaluate(
          ledgerWorker,
          `E(giveKit.mint)
            .mintPayment(harden({
              brand: giveKit.brand,
              value: ${give.value}n,
            }))
            .then(payment =>
              Promise.all([
                E(giveKit.nameAdmin).provideChild(${lit(name)}),
                E(wantKit.nameAdmin).provideChild(${lit(name)}),
              ]).then(([giveAccounts, wantAccounts]) =>
                E(trader).makeOffer(harden({
                  give: harden({
                    accountName: ${lit(give.accountName)},
                    issuer: giveKit.issuer,
                    nameAdmin: giveAccounts.nameAdmin,
                    payment,
                    sealer: giveKit.sealer,
                  }),
                  want: harden({
                    accountName: ${lit(want.accountName)},
                    issuer: wantKit.issuer,
                    nameAdmin: wantAccounts.nameAdmin,
                    value: ${want.value}n,
                    sealer: wantKit.sealer,
                  }),
                })),
              ),
            )`,
          ['giveKit', 'wantKit', 'trader'],
          [give.kitName, want.kitName, id],
        ),
      ),
    );
    const offerReports = await Promise.all([
      E(alice).describeOffer(),
      E(bob).describeOffer(),
    ]);
    offerReports.forEach(relay);

    const { escrowExchange } = await makeErtpEscrow({
      issuers: { A: money.issuer, B: stock.issuer },
    });
    const [bobPayout, alicePayout] = await escrowExchange(aliceOffer, bobOffer);
    const outcome = harden({ alicePayout, bobPayout });
    assert.equal(outcome.alicePayout.value, 10n);
    assert.equal(outcome.bobPayout.value, 100n);
    narrate(
      'Escrow',
      `Settled ${fmtAmt(outcome.alicePayout)} to Alice and ${fmtAmt(outcome.bobPayout)} to Bob.`,
    );
    const holdingReports = await Promise.all([
      E(alice).describeHoldings(),
      E(bob).describeHoldings(),
    ]);
    holdingReports.forEach(relay);
    narrate(
      'Narrator',
      'The successful actors remain available as alice, bob, and ledger.',
    );
    narrate('Narrator', 'Escrow integration passed.');
    return outcome;
  } finally {
    await closeClient();
  }
};

if (
  process.argv[1] &&
  import.meta.url === url.pathToFileURL(process.argv[1]).href
) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
