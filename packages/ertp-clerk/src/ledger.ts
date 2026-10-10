/**
 * @file The ledger's bootstrap object: ERTP issuer kits backed by a
 * GnuCash-schema SQL database, as passable remotables, with sturdyrefs
 * that survive restarts.
 *
 * A sturdyref's swissnum maps to a row naming a commodity and a facet
 * (issuer, brand, mint, or a purse's account). After a restart, the
 * object is revived from the ledger on first use; within one
 * incarnation, each commodity and account has one live object, so
 * identity checks (brand, payment liveness) keep working.
 */
import { Far } from '@endo/far';
import {
  createIssuerKit,
  openIssuerKit,
  type SqlDatabase,
  type Zone,
} from '@vattr/ertp-books/src/index.js';
import type {
  AccountPurse,
  Guid,
  IssuerKitForCommodity,
} from '@vattr/ertp-books/src/types.js';

/** Marks ertp-books objects as remotables so OCapN can pass them. */
const farZone: Zone = {
  exo: (interfaceName, methods) => Far(interfaceName, methods),
};

/** The swissnum of the bootstrap object. */
export const BOOTSTRAP_SWISSNUM = 'ledger';

type Facet = 'issuer' | 'brand' | 'mint' | 'purse';
type SturdyRow = {
  commodity_guid: string;
  facet: Facet;
  account_guid: string | null;
};

const ensureSturdyRefTable = (db: SqlDatabase) =>
  db.exec(`CREATE TABLE IF NOT EXISTS clerk_sturdyrefs (
    swissnum TEXT PRIMARY KEY,
    commodity_guid TEXT NOT NULL,
    facet TEXT NOT NULL,
    account_guid TEXT
  )`);

/**
 * @param makeSwissnum - fresh unguessable ASCII strings
 * @returns the bootstrap object, and a swissnum table for OCapN's
 *   `makeClient` that revives persisted objects on lookup
 */
export const makeLedger = ({
  db,
  makeGuid,
  nowMs,
  makeSwissnum,
}: {
  db: SqlDatabase;
  makeGuid: () => Guid;
  nowMs: () => number;
  makeSwissnum: () => string;
}) => {
  ensureSturdyRefTable(db);

  const kits = new Map<Guid, IssuerKitForCommodity>();
  /** what each live issuer, brand, or mint is, for `makeSturdyRef` */
  const kitFacets = new WeakMap<
    object,
    { commodityGuid: Guid; facet: Facet }
  >();
  const purses = new Map<Guid, AccountPurse>();

  const provideKit = (commodityGuid: Guid) => {
    let kit = kits.get(commodityGuid);
    if (!kit) {
      kit = openIssuerKit({
        db,
        commodityGuid,
        makeGuid,
        nowMs,
        zone: farZone,
      });
      kits.set(commodityGuid, kit);
      for (const facet of ['issuer', 'brand', 'mint'] as const) {
        kitFacets.set(kit.kit[facet], { commodityGuid, facet });
      }
    }
    return kit;
  };

  const providePurse = (commodityGuid: Guid, accountGuid: Guid) => {
    let purse = purses.get(accountGuid);
    if (!purse) {
      purse = provideKit(commodityGuid).accounts.openAccountPurse(accountGuid);
      purses.set(accountGuid, purse);
    }
    return purse;
  };

  const describe = (obj: object) => {
    const known = kitFacets.get(obj);
    if (known) return { ...known, accountGuid: null };
    for (const [commodityGuid, kit] of kits) {
      const accountGuid = kit.purseGuids.get(obj as AccountPurse);
      if (accountGuid) {
        purses.set(accountGuid, obj as AccountPurse);
        return { commodityGuid, facet: 'purse' as const, accountGuid };
      }
    }
    throw Error('not an issuer, brand, mint, or purse of this ledger');
  };

  const bootstrap = Far('LedgerBootstrap', {
    makeIssuerKit: (mnemonic: string) => {
      const { commodityGuid } = createIssuerKit({
        db,
        commodity: { namespace: 'COMMODITY', mnemonic },
        makeGuid,
        nowMs,
      });
      const { issuer, brand, mint } = provideKit(commodityGuid).kit;
      return harden({ issuer, brand, mint });
    },
    /** @returns a swissnum for `obj`, the same one each time */
    makeSturdyRef: (obj: object) => {
      const { commodityGuid, facet, accountGuid } = describe(obj);
      const existing = db
        .prepare<[string, string, string | null], { swissnum: string }>(
          `SELECT swissnum FROM clerk_sturdyrefs
           WHERE commodity_guid = ? AND facet = ? AND account_guid IS ?`,
        )
        .get(commodityGuid, facet, accountGuid);
      if (existing) return existing.swissnum;
      const swissnum = makeSwissnum();
      db.prepare(
        `INSERT INTO clerk_sturdyrefs
         (swissnum, commodity_guid, facet, account_guid) VALUES (?, ?, ?, ?)`,
      ).run(swissnum, commodityGuid, facet, accountGuid);
      return swissnum;
    },
  });

  const revive = (swissnum: string) => {
    if (swissnum === BOOTSTRAP_SWISSNUM) return bootstrap;
    const row = db
      .prepare<[string], SturdyRow>(
        `SELECT commodity_guid, facet, account_guid FROM clerk_sturdyrefs
         WHERE swissnum = ?`,
      )
      .get(swissnum);
    if (!row) return undefined;
    const commodityGuid = row.commodity_guid as Guid;
    if (row.facet === 'purse') {
      return providePurse(commodityGuid, row.account_guid as Guid);
    }
    return provideKit(commodityGuid).kit[row.facet];
  };

  const swissnumTable = {
    get: revive,
    set: () => {
      throw Error('ledger sturdyrefs are made by makeSturdyRef');
    },
  } as unknown as Map<string, unknown>;

  return { bootstrap, swissnumTable };
};
