// @ts-check

/* global E, Far, harden */

import {
  createIssuerKit,
  initGnuCashSchema,
  makeChartFacet,
  mockMakeGuid,
  openIssuerKitWithPurseGuids,
} from '../../src/index.ts';

/**
 * @import { CreateIssuerConfig, OpenIssuerConfig, Zone, } from '../../src/index.ts'
 */

/**
 * Create or open an issuer kit and pair it with the chart facet for the same
 * commodity.
 *
 * @param {(CreateIssuerConfig | OpenIssuerConfig) & { zone: Zone }} config
 */
export const makeIssuerKit = async config => {
  const hasCommodity = 'commodity' in config;
  const hasCommodityGuid = 'commodityGuid' in config;
  if (hasCommodity === hasCommodityGuid) {
    throw Error('specify exactly one of commodity or commodityGuid');
  }

  const kit = hasCommodityGuid
    ? await openIssuerKitWithPurseGuids(config)
    : await createIssuerKit(config);
  const chart = makeChartFacet({
    db: config.db,
    commodityGuid: kit.commodityGuid,
    getGuidFromSealed: kit.purses.getGuidFromSealed,
    zone: config.zone,
  });
  return harden({ ...kit, chart });
};
harden(makeIssuerKit);

/**
 * @param {{ lookup: (name: string) => unknown }} powers
 * @param {unknown} _context
 * @param {{ env: Record<string, string> }} options
 */
export const make = async (powers, _context, { env }) => {
  const db = await E(powers).lookup('sqlite-db');
  const zone = harden({ exo: (name, methods) => Far(name, methods) });
  const makeGuid = mockMakeGuid(BigInt(env.GUID_START ?? '0'));
  let now = Number(env.NOW_START ?? Date.now());
  const nowStep = Number(env.NOW_STEP ?? 0);
  const nowMs = () => {
    const current = now;
    now += nowStep;
    return current;
  };
  await initGnuCashSchema(db);

  const makeKit = makeIssuerKit;
  return Far('ledger service', {
    makeIssuerKit(commodityConfig) {
      return makeKit(
        harden({
          ...commodityConfig,
          db,
          makeGuid,
          nowMs,
          zone,
        }),
      );
    },
    async getBookRootAccountGuid() {
      const rows = await E(db).query(
        'SELECT root_account_guid FROM books LIMIT 1',
      );
      const guid = rows[0]?.root_account_guid;
      if (typeof guid !== 'string') {
        throw Error('book root account not found');
      }
      return guid;
    },
    async findCommodityGuid(namespace, mnemonic) {
      const rows = await E(db).query(
        `
          SELECT guid FROM commodities
          WHERE namespace = ? AND mnemonic = ?
        `,
        [namespace, mnemonic],
      );
      const guid = rows[0]?.guid;
      if (rows.length !== 1 || typeof guid !== 'string') {
        throw Error(`expected exactly one ${namespace}:${mnemonic} commodity`);
      }
      return guid;
    },
  });
};
harden(make);
