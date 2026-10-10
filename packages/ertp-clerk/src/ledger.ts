/**
 * @file The ledger's bootstrap object: ERTP issuer kits backed by a
 * GnuCash-schema SQL database, as passable remotables, with sturdyrefs
 * that survive restarts.
 *
 * A sturdyref's swissnum maps to a row naming a commodity and a facet:
 * issuer, brand, mint, a purse or deposit facet (by account GUID), a
 * payment (by check number), or an escrow seat (by escrow GUID and
 * side; see ./escrow.ts). After a restart, the object is revived from the
 * ledger on first use; a payment is live iff its hold is uncleared.
 * Within one incarnation each commodity, account, and payment has one
 * live object, so identity checks keep working and one hold can't be
 * spent twice.
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
  AmountLike,
  Guid,
  IssuerKitForCommodity,
} from '@vattr/ertp-books/src/types.js';
import { makeEscrows, type Side } from './escrow.js';

/** Marks ertp-books objects as remotables so OCapN can pass them. */
const farZone: Zone = {
  exo: (interfaceName, methods) => Far(interfaceName, methods),
};

type LivePayment = Parameters<
  IssuerKitForCommodity['kit']['issuer']['isLive']
>[0];

/** The swissnum of the bootstrap object. */
export const BOOTSTRAP_SWISSNUM = 'ledger';

type Facet =
  'issuer' | 'brand' | 'mint' | 'purse' | 'depositFacet' | 'payment' | 'seat';
type SturdyRow = {
  commodity_guid: string;
  facet: Facet;
  detail: string | null;
};

const ensureSturdyRefTable = (db: SqlDatabase) =>
  db.exec(`CREATE TABLE IF NOT EXISTS clerk_sturdyrefs (
    swissnum TEXT PRIMARY KEY,
    commodity_guid TEXT NOT NULL,
    facet TEXT NOT NULL,
    detail TEXT -- purse, depositFacet: account GUID; payment: check
                -- number; seat: escrow GUID:side
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
  const payments = new Map<string, object>();

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

  /** @throws if the payment's hold is cleared */
  const providePayment = async (commodityGuid: Guid, checkNumber: string) => {
    const kit = provideKit(commodityGuid);
    let payment = payments.get(checkNumber);
    if (!payment) {
      payment = kit.payments.openPayment(checkNumber);
      payments.set(checkNumber, payment);
    } else if (!(await kit.kit.issuer.isLive(payment as LivePayment))) {
      // as openPayment does for a hold cleared in an earlier incarnation
      throw Error('payment not live');
    }
    return payment;
  };

  const commodityOfBrand = (brand: unknown) => {
    const known = kitFacets.get(brand as object);
    if (known?.facet !== 'brand') throw Error('not a brand of this ledger');
    return known.commodityGuid;
  };

  const accountOf = (obj: unknown, commodityGuid: Guid) => {
    const kit = provideKit(commodityGuid);
    const accountGuid =
      kit.purseGuids.get(obj as AccountPurse) ??
      kit.depositFacetGuids.get(obj as object);
    if (!accountGuid) throw Error('not a purse or deposit facet of that brand');
    return accountGuid;
  };

  const escrows = makeEscrows({
    db,
    makeGuid,
    commodityOfBrand,
    provideKit,
    providePurse,
    accountOf,
  });

  const checkNumberOf = (kit: IssuerKitForCommodity, obj: object) => {
    try {
      return kit.payments.getCheckNumber(obj);
    } catch (err) {
      if ((err as Error).message === 'unknown payment') return undefined;
      throw err;
    }
  };

  const describe = (obj: object) => {
    const known = kitFacets.get(obj);
    if (known) return { ...known, detail: null };
    for (const [commodityGuid, kit] of kits) {
      const accountGuid = kit.purseGuids.get(obj as AccountPurse);
      if (accountGuid) {
        purses.set(accountGuid, obj as AccountPurse);
        return { commodityGuid, facet: 'purse' as const, detail: accountGuid };
      }
      const facetAccount = kit.depositFacetGuids.get(obj);
      if (facetAccount) {
        return {
          commodityGuid,
          facet: 'depositFacet' as const,
          detail: facetAccount,
        };
      }
      const checkNumber = checkNumberOf(kit, obj);
      if (checkNumber) {
        payments.set(checkNumber, obj);
        return {
          commodityGuid,
          facet: 'payment' as const,
          detail: checkNumber,
        };
      }
    }
    const seat = escrows.describeSeat(obj);
    if (seat) return { ...seat, facet: 'seat' as const };
    throw Error('not an object of this ledger');
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
    /** @see makeEscrows */
    makeEscrow: (give: AmountLike, want: AmountLike) =>
      escrows.makeEscrow(give, want),
    /** @returns a swissnum for `obj`, the same one each time */
    makeSturdyRef: (obj: object) => {
      const { commodityGuid, facet, detail } = describe(obj);
      const existing = db
        .prepare<[string, string, string | null], { swissnum: string }>(
          `SELECT swissnum FROM clerk_sturdyrefs
           WHERE commodity_guid = ? AND facet = ? AND detail IS ?`,
        )
        .get(commodityGuid, facet, detail);
      if (existing) return existing.swissnum;
      const swissnum = makeSwissnum();
      db.prepare(
        `INSERT INTO clerk_sturdyrefs
         (swissnum, commodity_guid, facet, detail) VALUES (?, ?, ?, ?)`,
      ).run(swissnum, commodityGuid, facet, detail);
      return swissnum;
    },
  });

  const revive = (swissnum: string) => {
    if (swissnum === BOOTSTRAP_SWISSNUM) return bootstrap;
    const row = db
      .prepare<[string], SturdyRow>(
        `SELECT commodity_guid, facet, detail FROM clerk_sturdyrefs
         WHERE swissnum = ?`,
      )
      .get(swissnum);
    if (!row) return undefined;
    const commodityGuid = row.commodity_guid as Guid;
    if (row.facet === 'purse') {
      return providePurse(commodityGuid, row.detail as Guid);
    }
    if (row.facet === 'depositFacet') {
      return providePurse(commodityGuid, row.detail as Guid).getDepositFacet();
    }
    if (row.facet === 'seat') {
      const [escrowGuid, side] = (row.detail as string).split(':');
      return escrows.provideSeat(escrowGuid as Guid, side as Side);
    }
    if (row.facet === 'payment') {
      return providePayment(commodityGuid, row.detail as string);
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
