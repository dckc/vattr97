// @ts-check

// Endo confined workers endow these globals; importing them would enlarge the archive.
/* global E, Far, M, harden, makeExo */

import {
  createIssuerKit,
  ensureGnuCashSchema,
  makeChartFacet,
  makeHashedGuids,
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
  const [mintInfo, label] = await Promise.all([
    E(kit.mintInfo).getMintInfo(),
    E(kit.brand).getAllegedName(),
  ]);
  const placements = [
    {
      accountGuid: mintInfo.holdingAccountGuid,
      path: ['Issuer', label, 'Holding'],
      accountType,
    },
    {
      accountGuid: mintInfo.issuancePurseGuid,
      path: ['Issuer', label, 'Issuance'],
      accountType: 'LIABILITY',
    },
  ];
  await Promise.all(
    placements.map(account => E(chart).placeAccountAtPath(account)),
  );
  return harden({
    ...kit,
    chart,
    mintAccountNames: placements.map(({ path }) => path.join('/')),
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

const MnemonicShape = M.splitRecord({ mnemonic: M.string() });

const CommodityShape = M.splitRecord(
  { mnemonic: M.string() },
  {
    fullname: M.string(),
    fraction: M.number(),
    quoteFlag: M.number(),
  },
);

const LedgerServiceI = M.interface('LedgerService', {
  help: M.call().returns(M.string()),
  makeCurrencyIssuerKit: M.call(MnemonicShape).returns(M.promise()),
  makeCommodityIssuerKit: M.call(CommodityShape).returns(M.promise()),
});

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
  const [db, clock] = await Promise.all([
    E(powers).lookup('sqlite-db'),
    E(powers).lookup('clock'),
  ]);
  const zone = harden({
    exo: (name, methods) => Far(name, methods),
  });
  const guidSeed = await E(clock).now();
  const makeGuid = makeHashedGuids(String(guidSeed));
  await ensureGnuCashSchema(db);

  const withLedgerPowers = commodityConfig =>
    harden({
      ...commodityConfig,
      clock,
      db,
      makeGuid,
      zone,
    });
  return makeExo('LedgerService', LedgerServiceI, {
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
      const kit = await makeCommodityIssuerKit(withLedgerPowers({ commodity }));
      const { chart, ...sharedKit } = kit;
      const nameAdmin = makeChartNameAdmin({ chart });
      return harden({ ...sharedKit, nameAdmin });
    },
    help() {
      return [
        'Ledger service:',
        "makeCurrencyIssuerKit({ mnemonic: 'USD' })",
        "makeCommodityIssuerKit({ mnemonic: 'STOCK', fullname?, fraction?, quoteFlag? })",
      ].join('\n');
    },
  });
};

export const make = (powers, _context, options) => makeLedger(powers, options);
harden(make);
