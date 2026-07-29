#!/usr/bin/env -S node --import ts-blank-space/register
import '@endo/init';

import { makeCancelKit } from '@endo/cancel';
import { makeEndoClient, start } from '@endo/daemon';
import { E } from '@endo/eventual-send';
import { Far } from '@endo/far';
import { whereEndoSock } from '@endo/where';
import {
  createIssuerKit,
  initGnuCashSchema,
  makeChartFacet,
  makeErtpEscrow,
  mockMakeGuid,
  openIssuerKitWithPurseGuids,
} from '@finquick/ertp-dacct';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const usage = `Usage: npm run test:integration

Environment:
  DB_PATH  retain the integration database at this path`;

const sqliteModule = new URL(
  '../../sqlite-plugin/src/sqlite-db.js',
  import.meta.url,
).href;

export const makeTraderActor = ({
  name,
  giveIssuer,
  wantIssuer,
  givePayment,
  wantValue,
  sealGivePurse,
  sealWantPurse,
}) => {
  let offerMade = false;
  let sealedPurses;

  return Far(`${name} trader`, {
    async makeOffer() {
      if (offerMade) {
        throw Error(`${name} already made an offer`);
      }
      offerMade = true;

      const [refundPurse, wantPurse, wantBrand] = await Promise.all([
        E(giveIssuer).makeEmptyPurse(),
        E(wantIssuer).makeEmptyPurse(),
        E(wantIssuer).getBrand(),
      ]);
      const [refund, want] = await Promise.all([
        E(refundPurse).getDepositFacet(),
        E(wantPurse).getDepositFacet(),
      ]);
      sealedPurses = harden({
        refund: sealGivePurse(refundPurse),
        want: sealWantPurse(wantPurse),
      });

      return harden({
        give: Promise.resolve(givePayment),
        want: harden({ brand: wantBrand, value: wantValue }),
        payouts: harden({ refund, want }),
        cancellationP: new Promise(() => {}),
      });
    },
    getSealedPurses() {
      if (!sealedPurses) {
        throw Error(`${name} has not made an offer`);
      }
      return sealedPurses;
    },
  });
};

const makeEscrowActor = async ({ moneyIssuer, stockIssuer }) => {
  const { escrowExchange } = await makeErtpEscrow({
    issuers: { A: moneyIssuer, B: stockIssuer },
  });

  return Far('escrow service', {
    async exchange(aliceOfferP, bobOfferP) {
      const [aliceOffer, bobOffer] = await Promise.all([
        aliceOfferP,
        bobOfferP,
      ]);
      const [bobPayout, alicePayout] = await escrowExchange(
        aliceOffer,
        bobOffer,
      );
      return harden({ alicePayout, bobPayout });
    },
  });
};

export const main = async (
  argv = process.argv,
  env = process.env,
  {
    makeClient = makeEndoClient,
    onSignal = process.once.bind(process),
    pid = process.pid,
    platform = process.platform,
    randomBytes = crypto.randomBytes,
    startDaemon = start,
    stdout = process.stdout,
    tmpdir = os.tmpdir,
    unlinkSync = fs.unlinkSync,
    userInfo = os.userInfo,
  } = {},
) => {
  if (argv.slice(2).some(arg => arg === '--help' || arg === '-h')) {
    stdout.write(`${usage}\n`);
    return undefined;
  }

  const suppliedDatabasePath = env.DB_PATH;
  const databasePath =
    suppliedDatabasePath ??
    path.join(
      tmpdir(),
      `vattr97-escrow-${pid}-${randomBytes(8).toString('hex')}.sqlite`,
    );
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

  const { getBootstrap, closed } = client;
  const bootstrap = getBootstrap();
  const host = E(bootstrap).host();
  let db;

  try {
    db = await E(host).makeUnconfined('@node', sqliteModule, {
      powersName: ['@none'],
      resultName: ['escrow-sqlite-db'],
      env: { DB_PATH: databasePath },
    });
    await initGnuCashSchema(db);
    const bookRows = await E(db).query(
      'SELECT root_account_guid FROM books LIMIT 1',
    );
    const rootAccountGuid = bookRows[0]?.root_account_guid;
    if (typeof rootAccountGuid !== 'string') {
      throw Error('book root account not found');
    }
    const usdRows = await E(db).query(
      `
        SELECT guid FROM commodities
        WHERE namespace = 'CURRENCY' AND mnemonic = 'USD'
      `,
    );
    const usdCommodityGuid = usdRows[0]?.guid;
    if (usdRows.length !== 1 || typeof usdCommodityGuid !== 'string') {
      throw Error('expected exactly one CURRENCY:USD commodity');
    }

    const makeTestClock = () => {
      let now = Date.UTC(2020, 0, 1, 9, 15);
      const stepMs = 3 * 24 * 60 * 60 * 1000;
      return () => {
        const current = now;
        now += stepMs;
        return current;
      };
    };
    const nowMs = makeTestClock();
    const moneyKit = await openIssuerKitWithPurseGuids(
      harden({
        db,
        commodityGuid: usdCommodityGuid,
        makeGuid: mockMakeGuid(),
        nowMs,
      }),
    );
    const stockKit = await createIssuerKit(
      harden({
        db,
        commodity: { mnemonic: 'STOCK' },
        makeGuid: mockMakeGuid(1000n),
        nowMs,
      }),
    );

    const moneyChart = makeChartFacet({
      db,
      commodityGuid: moneyKit.commodityGuid,
      getGuidFromSealed: moneyKit.purses.getGuidFromSealed,
    });
    const stockChart = makeChartFacet({
      db,
      commodityGuid: stockKit.commodityGuid,
      getGuidFromSealed: stockKit.purses.getGuidFromSealed,
    });
    const [moneyLabel, stockLabel, moneyMintInfo, stockMintInfo] =
      await Promise.all([
        E(moneyKit.brand).getAllegedName(),
        E(stockKit.brand).getAllegedName(),
        E(moneyKit.mintInfo).getMintInfo(),
        E(stockKit.mintInfo).getMintInfo(),
      ]);
    await Promise.all([
      E(moneyChart).placeAccount({
        accountGuid: moneyMintInfo.holdingAccountGuid,
        name: `${moneyLabel} Mint Holding`,
        parentGuid: rootAccountGuid,
        accountType: 'BANK',
      }),
      E(moneyChart).placeAccount({
        accountGuid: moneyMintInfo.recoveryPurseGuid,
        name: `${moneyLabel} Mint Recovery`,
        parentGuid: rootAccountGuid,
        accountType: 'BANK',
      }),
      E(stockChart).placeAccount({
        accountGuid: stockMintInfo.holdingAccountGuid,
        name: `${stockLabel} Mint Holding`,
        parentGuid: rootAccountGuid,
        accountType: 'STOCK',
      }),
      E(stockChart).placeAccount({
        accountGuid: stockMintInfo.recoveryPurseGuid,
        name: `${stockLabel} Mint Recovery`,
        parentGuid: rootAccountGuid,
        accountType: 'STOCK',
      }),
    ]);
    const makePurseSealer = kit => purse => {
      kit.purses.getGuid(purse);
      return kit.sealer.seal(purse);
    };
    const sealMoneyPurse = makePurseSealer(moneyKit);
    const sealStockPurse = makePurseSealer(stockKit);
    const [alicePayment, bobPayment] = await Promise.all([
      E(moneyKit.mint).mintPayment(
        harden({ brand: moneyKit.brand, value: 100n }),
      ),
      E(stockKit.mint).mintPayment(
        harden({ brand: stockKit.brand, value: 10n }),
      ),
    ]);

    const alice = makeTraderActor({
      name: 'Alice',
      giveIssuer: moneyKit.issuer,
      wantIssuer: stockKit.issuer,
      givePayment: alicePayment,
      wantValue: 10n,
      sealGivePurse: sealMoneyPurse,
      sealWantPurse: sealStockPurse,
    });
    const bob = makeTraderActor({
      name: 'Bob',
      giveIssuer: stockKit.issuer,
      wantIssuer: moneyKit.issuer,
      givePayment: bobPayment,
      wantValue: 100n,
      sealGivePurse: sealStockPurse,
      sealWantPurse: sealMoneyPurse,
    });
    const escrow = await makeEscrowActor({
      moneyIssuer: moneyKit.issuer,
      stockIssuer: stockKit.issuer,
    });

    const [aliceOffer, bobOffer] = await Promise.all([
      E(alice).makeOffer(),
      E(bob).makeOffer(),
    ]);
    const [alicePurses, bobPurses] = await Promise.all([
      E(alice).getSealedPurses(),
      E(bob).getSealedPurses(),
    ]);
    await Promise.all([
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

    const outcome = await E(escrow).exchange(aliceOffer, bobOffer);
    assert.equal(outcome.alicePayout.value, 10n);
    assert.equal(outcome.bobPayout.value, 100n);
    stdout.write('escrow integration passed\n');
    return outcome;
  } finally {
    if (db) {
      await E(db)
        .close()
        .catch(() => {});
    }
    cancel(Error('normal termination'));
    await closed.catch(() => {});
    if (!suppliedDatabasePath) {
      try {
        unlinkSync(databasePath);
      } catch (error) {
        if (
          !(
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ENOENT'
          )
        ) {
          throw error;
        }
      }
    }
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
