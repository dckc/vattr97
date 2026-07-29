// @ts-check

// Endo confined workers endow these globals; importing them would enlarge the archive.
/* global E, Far, harden */

import {
  createIssuerKit,
  initGnuCashSchema,
  makeChartFacet,
  mockMakeGuid,
  openIssuerKitWithPurseGuids,
} from '../../src/index.ts';
import { getCommodityRow } from '../../src/db-helpers.ts';

/**
 * @import { CreateIssuerConfig, OpenIssuerConfig, Zone, } from '../../src/index.ts'
 */

/**
 * Add a chart to an issuer kit and place its mint accounts.
 *
 * @param {(CreateIssuerConfig | OpenIssuerConfig) & { zone: Zone }} config
 * @param {Awaited<ReturnType<typeof createIssuerKit>>} kit
 * @param {'BANK' | 'STOCK'} accountType
 */
const addChartAndPlaceMintAccounts = async (config, kit, accountType) => {
  const chart = makeChartFacet({
    db: config.db,
    commodityGuid: kit.commodityGuid,
    getGuidFromSealed: kit.purses.getGuidFromSealed,
    accountType,
    zone: config.zone,
  });
  const [mintInfo, label, bookRows] = await Promise.all([
    E(kit.mintInfo).getMintInfo(),
    E(kit.brand).getAllegedName(),
    E(config.db).query(
      'SELECT root_account_guid FROM books LIMIT 1',
    ),
  ]);
  const rootAccountGuid = bookRows[0]?.root_account_guid;
  if (typeof rootAccountGuid !== 'string') {
    throw Error('book root account not found');
  }
  const placements = [
    {
      accountGuid: mintInfo.holdingAccountGuid,
      name: `${label} Mint Holding`,
      parentGuid: rootAccountGuid,
      accountType,
    },
    {
      accountGuid: mintInfo.recoveryPurseGuid,
      name: `${label} Mint Recovery`,
      parentGuid: rootAccountGuid,
      accountType,
    },
  ];
  await Promise.all(
    placements.map(account => E(chart).placeAccount(account)),
  );
  return harden({
    ...kit,
    chart,
    mintAccountNames: placements.map(({ name }) => name),
  });
};

/**
 * @param {OpenIssuerConfig & { zone: Zone }} config
 */
export const makeCurrencyIssuerKit = async config => {
  const commodity = await getCommodityRow(config.db, config.commodityGuid);
  if (!commodity) {
    throw Error('commodity not found');
  }
  if (commodity.namespace !== 'CURRENCY') {
    throw Error(`expected CURRENCY commodity, got ${commodity.namespace}`);
  }
  const kit = await openIssuerKitWithPurseGuids(config);
  return addChartAndPlaceMintAccounts(config, kit, 'BANK');
};
harden(makeCurrencyIssuerKit);

/**
 * @param {CreateIssuerConfig & { zone: Zone }} config
 */
export const makeCommodityIssuerKit = async config => {
  const commodityConfig = harden({
    ...config,
    commodity: harden({
      ...config.commodity,
      namespace: 'COMMODITY',
    }),
  });
  const kit = await createIssuerKit(commodityConfig);
  return addChartAndPlaceMintAccounts(commodityConfig, kit, 'STOCK');
};
harden(makeCommodityIssuerKit);

const makeChartNameAdmin = ({ chart }) => {
  const makeNameHubKit = path => {
    const values = new Map();
    const children = new Map();
    const label = path.join('/') || 'accounts';
    const nameHub = Far(`${label} name hub`, {
      has: name => values.has(name),
      list: () => harden([...values.keys()]),
      lookup: name => {
        if (!values.has(name)) {
          throw Error(`unknown account name: ${name}`);
        }
        return values.get(name);
      },
    });
    const nameAdmin = Far(`${label} name admin`, {
      provideChild(name) {
        if (!children.has(name)) {
          children.set(name, makeNameHubKit(harden([...path, name])));
        }
        return children.get(name);
      },
      async update(name, sealedPurse) {
        await E(chart).placePurseAtPath({
          sealedPurse,
          path: harden([...path, name]),
        });
        values.set(name, sealedPurse);
      },
    });
    return harden({ nameHub, nameAdmin });
  };
  return makeNameHubKit(harden([])).nameAdmin;
};

/**
 * @param {{ lookup: (name: string) => unknown }} powers
 * @param {{ env: Record<string, string> }} options
 */
export const makeLedger = async (powers, { env }) => {
  const db = await E(powers).lookup('sqlite-db');
  const zone = harden({
    exo: (name, methods) => Far(name, methods),
  });
  const makeGuid = mockMakeGuid(BigInt(env.GUID_START ?? '0'));
  let now = Number(env.NOW_START ?? Date.now());
  const nowStep = Number(env.NOW_STEP ?? 0);
  const nowMs = () => {
    const current = now;
    now += nowStep;
    return current;
  };
  await initGnuCashSchema(db);

  const withLedgerPowers = commodityConfig =>
    harden({
      ...commodityConfig,
      db,
      makeGuid,
      nowMs,
      zone,
    });
  return Far('ledger service', {
    async makeCurrencyIssuerKit({ mnemonic }) {
      const rows = await E(db).query(
        `
          SELECT guid FROM commodities
          WHERE namespace = 'CURRENCY' AND mnemonic = ?
        `,
        [mnemonic],
      );
      const commodityGuid = rows[0]?.guid;
      if (rows.length !== 1 || typeof commodityGuid !== 'string') {
        throw Error(`expected exactly one CURRENCY:${mnemonic} commodity`);
      }
      const kit = await makeCurrencyIssuerKit(
        withLedgerPowers({ commodityGuid }),
      );
      const { chart, ...sharedKit } = kit;
      const nameAdmin = makeChartNameAdmin({ chart });
      return harden({ ...sharedKit, nameAdmin });
    },
    async makeCommodityIssuerKit(commodity) {
      const kit = await makeCommodityIssuerKit(
        withLedgerPowers({ commodity }),
      );
      const { chart, ...sharedKit } = kit;
      const nameAdmin = makeChartNameAdmin({ chart });
      return harden({ ...sharedKit, nameAdmin });
    },
  });
};

export const make = (powers, _context, options) =>
  makeLedger(powers, options);
harden(make);
