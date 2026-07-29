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
const ledgerModule = new URL('guests/ledger.js', import.meta.url).href;
const traderModule = new URL('guests/trader.js', import.meta.url).href;

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

const endoMake = async ({
  agent,
  moduleLocation,
  archiveName,
  caplets,
}) => {
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

const placeMintAccounts = async ({ rootAccountGuid, entries }) => {
  const descriptions = await Promise.all(
    entries.map(
      async ({ brand, mintInfo: mintInfoFacet, chart, accountType }) => {
        const [label, mintInfo] = await Promise.all([
          E(brand).getAllegedName(),
          E(mintInfoFacet).getMintInfo(),
        ]);
        return { chart, accountType, label, mintInfo };
      },
    ),
  );
  await Promise.all(
    descriptions.flatMap(({ chart, accountType, label, mintInfo }) => [
      E(chart).placeAccount({
        accountGuid: mintInfo.holdingAccountGuid,
        name: `${label} Mint Holding`,
        parentGuid: rootAccountGuid,
        accountType,
      }),
      E(chart).placeAccount({
        accountGuid: mintInfo.recoveryPurseGuid,
        name: `${label} Mint Recovery`,
        parentGuid: rootAccountGuid,
        accountType,
      }),
    ]),
  );
};

const setupLedger = async ({ host, databasePath, archiveNonce }) => {
  const dbName = 'escrow-sqlite-db';
  await E(host).makeUnconfined('@node', sqliteModule, {
    powersName: ['@none'],
    resultName: dbName,
    env: { DB_PATH: databasePath },
  });

  const ledgerAgent = await provideGuest(host, 'ledger');
  await E(host).move([dbName], [ledgerAgent, 'sqlite-db']);
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
          env: {
            GUID_START: '0',
            NOW_START: String(Date.UTC(2020, 0, 1, 9, 15)),
            NOW_STEP: String(3 * 24 * 60 * 60 * 1000),
          },
        },
      },
    ],
  });
  await E(host).remove(ledgerAgent);

  const [rootAccountGuid, usdCommodityGuid] = await Promise.all([
    E(ledger).getBookRootAccountGuid(),
    E(ledger).findCommodityGuid('CURRENCY', 'USD'),
  ]);
  const moneyKitName = 'escrow-money-kit';
  const stockKitName = 'escrow-stock-kit';
  const moneyKit = await E(host).evaluate(
    ledgerWorker,
    `E(ledger).makeIssuerKit({ commodityGuid: ${JSON.stringify(
      usdCommodityGuid,
    )} })`,
    ['ledger'],
    [ledgerName],
    moneyKitName,
  );
  const stockKit = await E(host).evaluate(
    ledgerWorker,
    "E(ledger).makeIssuerKit({ commodity: { mnemonic: 'STOCK' } })",
    ['ledger'],
    [ledgerName],
    stockKitName,
  );
  await placeMintAccounts({
    rootAccountGuid,
    entries: [
      {
        brand: moneyKit.brand,
        mintInfo: moneyKit.mintInfo,
        chart: moneyKit.chart,
        accountType: 'BANK',
      },
      {
        brand: stockKit.brand,
        mintInfo: stockKit.mintInfo,
        chart: stockKit.chart,
        accountType: 'STOCK',
      },
    ],
  });

  return harden({
    ledgerWorker,
    rootAccountGuid,
    money: harden({
      kitName: moneyKitName,
      issuer: moneyKit.issuer,
      chart: moneyKit.chart,
    }),
    stock: harden({
      kitName: stockKitName,
      issuer: stockKit.issuer,
      chart: stockKit.chart,
    }),
  });
};

const placeTraderAccounts = async ({
  rootAccountGuid,
  moneyChart,
  stockChart,
  alicePurses,
  bobPurses,
}) =>
  Promise.all([
    E(moneyChart).placePurse({
      sealedPurse: alicePurses.refund,
      name: 'Alice USD',
      parentGuid: rootAccountGuid,
      accountType: 'BANK',
    }),
    E(stockChart).placePurse({
      sealedPurse: alicePurses.want,
      name: 'Alice STOCK',
      parentGuid: rootAccountGuid,
      accountType: 'STOCK',
    }),
    E(stockChart).placePurse({
      sealedPurse: bobPurses.refund,
      name: 'Bob STOCK',
      parentGuid: rootAccountGuid,
      accountType: 'STOCK',
    }),
    E(moneyChart).placePurse({
      sealedPurse: bobPurses.want,
      name: 'Bob USD',
      parentGuid: rootAccountGuid,
      accountType: 'BANK',
    }),
  ]);

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
    const { ledgerWorker, rootAccountGuid, money, stock } =
      await setupLedger({
        host,
        databasePath,
        archiveNonce: runId,
      });

    const [aliceAgent, bobAgent] = await Promise.all([
      provideGuest(host, 'alice'),
      provideGuest(host, 'bob'),
    ]);

    const alicePaymentName = 'escrow-alice-payment';
    const bobPaymentName = 'escrow-bob-payment';
    await Promise.all([
      E(host).evaluate(
        ledgerWorker,
        'E(kit.mint).mintPayment(harden({ brand: kit.brand, value: 100n }))',
        ['kit'],
        [money.kitName],
        alicePaymentName,
      ),
      E(host).evaluate(
        ledgerWorker,
        'E(kit.mint).mintPayment(harden({ brand: kit.brand, value: 10n }))',
        ['kit'],
        [stock.kitName],
        bobPaymentName,
      ),
    ]);
    const aliceKitName = 'escrow-alice-kit';
    const bobKitName = 'escrow-bob-kit';
    await Promise.all([
      E(host).evaluate(
        ledgerWorker,
        `harden({
          give: harden({
            issuer: giveKit.issuer,
            payment,
            sealer: giveKit.sealer,
          }),
          want: harden({
            issuer: wantKit.issuer,
            value: 10n,
            sealer: wantKit.sealer,
          }),
        })`,
        ['giveKit', 'wantKit', 'payment'],
        [money.kitName, stock.kitName, alicePaymentName],
        aliceKitName,
      ),
      E(host).evaluate(
        ledgerWorker,
        `harden({
          give: harden({
            issuer: giveKit.issuer,
            payment,
            sealer: giveKit.sealer,
          }),
          want: harden({
            issuer: wantKit.issuer,
            value: 100n,
            sealer: wantKit.sealer,
          }),
        })`,
        ['giveKit', 'wantKit', 'payment'],
        [stock.kitName, money.kitName, bobPaymentName],
        bobKitName,
      ),
    ]);
    await Promise.all([
      E(host).move([aliceKitName], [aliceAgent, 'trader-kit']),
      E(host).move([bobKitName], [bobAgent, 'trader-kit']),
    ]);
    const [alice, bob] = await endoMake({
      agent: host,
      moduleLocation: traderModule,
      archiveName: `tmp-trader-archive-${runId}`,
      caplets: [
        {
          workerName: undefined,
          options: {
            powersName: aliceAgent,
            resultName: 'alice',
            env: { TRADER_NAME: 'Alice' },
          },
        },
        {
          workerName: undefined,
          options: {
            powersName: bobAgent,
            resultName: 'bob',
            env: { TRADER_NAME: 'Bob' },
          },
        },
      ],
    });

    const [aliceOffer, bobOffer] = await Promise.all([
      E(alice).makeOffer(),
      E(bob).makeOffer(),
    ]);
    const [alicePurses, bobPurses] = await Promise.all([
      E(alice).getSealedPurses(),
      E(bob).getSealedPurses(),
    ]);
    await placeTraderAccounts({
      rootAccountGuid,
      moneyChart: money.chart,
      stockChart: stock.chart,
      alicePurses,
      bobPurses,
    });

    const { escrowExchange } = await makeErtpEscrow({
      issuers: { A: money.issuer, B: stock.issuer },
    });
    const [bobPayout, alicePayout] = await escrowExchange(
      aliceOffer,
      bobOffer,
    );
    const outcome = harden({ alicePayout, bobPayout });
    assert.equal(outcome.alicePayout.value, 10n);
    assert.equal(outcome.bobPayout.value, 100n);
    stdout.write('escrow integration passed\n');
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
