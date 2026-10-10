/**
 * @file Two-party escrow as a state machine in the ledger's database.
 *
 * Party `a` gives some of one commodity for some of another, which
 * party `b` gives. Each party has a seat. An offer deposits the
 * party's payment into the escrow's holding purse for that side; when
 * both sides have offered, the escrow pays each party what it wants.
 * Either party may cancel before then, which refunds whatever was
 * offered.
 *
 * All state is in `clerk_escrows`; a seat is a facade over its row, so
 * it can be revived after a restart. Each transition after its last
 * `await` is synchronous, so in a Durable Object its writes commit
 * together.
 */
import { Far } from '@endo/far';
import type { SqlDatabase } from '@vattr/ertp-books/src/index.js';
import type {
  AccountPurse,
  AmountLike,
  Guid,
  IssuerKitForCommodity,
} from '@vattr/ertp-books/src/types.js';

export type Side = 'a' | 'b';
const other = (side: Side): Side => (side === 'a' ? 'b' : 'a');

type EscrowState = 'open' | 'settled' | 'cancelled';

type SideRow = {
  commodity: Guid;
  value: string;
  holding: Guid;
  refund: Guid | null;
  payout: Guid | null;
};

const ensureEscrowTable = (db: SqlDatabase) =>
  db.exec(`CREATE TABLE IF NOT EXISTS clerk_escrows (
    guid TEXT PRIMARY KEY,
    state TEXT NOT NULL, -- open, settled, cancelled
    -- per side: what it gives, where the escrow holds it, and, once it
    -- has offered, the accounts for its refund and its payout
    a_commodity TEXT NOT NULL,
    a_value TEXT NOT NULL,
    a_holding TEXT NOT NULL,
    a_refund TEXT,
    a_payout TEXT,
    b_commodity TEXT NOT NULL,
    b_value TEXT NOT NULL,
    b_holding TEXT NOT NULL,
    b_refund TEXT,
    b_payout TEXT
  )`);

/**
 * @param commodityOfBrand - which of the ledger's commodities a brand
 *   is; throws for a foreign brand
 * @param accountOf - the account behind a purse or deposit facet of the
 *   given commodity; throws otherwise
 */
export const makeEscrows = ({
  db,
  makeGuid,
  commodityOfBrand,
  provideKit,
  providePurse,
  accountOf,
}: {
  db: SqlDatabase;
  makeGuid: () => Guid;
  commodityOfBrand: (brand: unknown) => Guid;
  provideKit: (commodityGuid: Guid) => IssuerKitForCommodity;
  providePurse: (commodityGuid: Guid, accountGuid: Guid) => AccountPurse;
  accountOf: (obj: unknown, commodityGuid: Guid) => Guid;
}) => {
  ensureEscrowTable(db);

  const seats = new Map<string, object>();
  const seatIds = new WeakMap<object, { escrowGuid: Guid; side: Side }>();

  const getState = (escrowGuid: Guid) => {
    const row = db
      .prepare<[string], { state: EscrowState }>(
        'SELECT state FROM clerk_escrows WHERE guid = ?',
      )
      .get(escrowGuid);
    if (!row) throw Error('no such escrow');
    return row.state;
  };

  const getSide = (escrowGuid: Guid, side: Side): SideRow =>
    db
      .prepare<[string], SideRow>(
        `SELECT ${side}_commodity AS commodity, ${side}_value AS value,
                ${side}_holding AS holding, ${side}_refund AS refund,
                ${side}_payout AS payout
         FROM clerk_escrows WHERE guid = ?`,
      )
      .get(escrowGuid)!;

  const amountOf = ({ commodity, value }: SideRow) =>
    harden({ brand: provideKit(commodity).kit.brand, value: BigInt(value) });

  const setState = (escrowGuid: Guid, state: EscrowState) =>
    db
      .prepare('UPDATE clerk_escrows SET state = ? WHERE guid = ?')
      .run(state, escrowGuid);

  /** move what the escrow holds for `from` into account `to` */
  const release = (from: SideRow, to: Guid) =>
    providePurse(from.commodity, to).deposit(
      providePurse(from.commodity, from.holding).withdraw(amountOf(from)),
    );

  const assertOpen = (escrowGuid: Guid) => {
    const state = getState(escrowGuid);
    if (state !== 'open') throw Error(`escrow ${state}`);
  };

  const settle = (escrowGuid: Guid) => {
    const a = getSide(escrowGuid, 'a');
    const b = getSide(escrowGuid, 'b');
    release(a, b.payout!);
    release(b, a.payout!);
    setState(escrowGuid, 'settled');
  };

  const provideSeat = (escrowGuid: Guid, side: Side) => {
    const key = `${escrowGuid}:${side}`;
    const existing = seats.get(key);
    if (existing) return existing;
    getState(escrowGuid); // throws for an unknown escrow
    const seat = Far('EscrowSeat', {
      getState: () => getState(escrowGuid),
      /** @returns what this side gives and what it wants */
      getTerms: () =>
        harden({
          give: amountOf(getSide(escrowGuid, side)),
          want: amountOf(getSide(escrowGuid, other(side))),
        }),
      /**
       * @param payment - exactly what this side gives
       * @param refund - purse or deposit facet for the given commodity
       * @param payout - purse or deposit facet for the wanted commodity
       */
      offer: async (payment: object, refund: object, payout: object) => {
        assertOpen(escrowGuid);
        const mine = getSide(escrowGuid, side);
        const theirs = getSide(escrowGuid, other(side));
        const refundAccount = accountOf(refund, mine.commodity);
        const payoutAccount = accountOf(payout, theirs.commodity);
        const { issuer } = provideKit(mine.commodity).kit;
        const amount = await issuer.getAmountOf(payment as never);
        if ((amount as AmountLike).value !== BigInt(mine.value)) {
          throw Error(`offer must give exactly ${mine.value}`);
        }
        // the state may have changed while we waited
        assertOpen(escrowGuid);
        if (getSide(escrowGuid, side).refund) throw Error('already offered');
        providePurse(mine.commodity, mine.holding).deposit(payment);
        db.prepare(
          `UPDATE clerk_escrows SET ${side}_refund = ?, ${side}_payout = ?
           WHERE guid = ?`,
        ).run(refundAccount, payoutAccount, escrowGuid);
        if (getSide(escrowGuid, other(side)).refund) settle(escrowGuid);
        return getState(escrowGuid);
      },
      /** refund whatever was offered; only while the escrow is open */
      cancel: () => {
        assertOpen(escrowGuid);
        for (const s of ['a', 'b'] as const) {
          const row = getSide(escrowGuid, s);
          if (row.refund) release(row, row.refund);
        }
        setState(escrowGuid, 'cancelled');
        return 'cancelled';
      },
    });
    seats.set(key, seat);
    seatIds.set(seat, { escrowGuid, side });
    return seat;
  };

  /**
   * @param give - what party `a` gives
   * @param want - what party `b` gives
   * @returns a seat for each party
   */
  const makeEscrow = (give: AmountLike, want: AmountLike) => {
    const sides = { a: give, b: want };
    const escrowGuid = makeGuid();
    const row: Record<string, string> = {};
    for (const side of ['a', 'b'] as const) {
      const { brand, value } = sides[side];
      if (typeof value !== 'bigint' || value <= 0n) {
        throw Error('amount value must be a positive bigint');
      }
      const commodity = commodityOfBrand(brand);
      const holding = accountOf(
        provideKit(commodity).kit.issuer.makeEmptyPurse(),
        commodity,
      );
      Object.assign(row, {
        [`${side}_commodity`]: commodity,
        [`${side}_value`]: `${value}`,
        [`${side}_holding`]: holding,
      });
    }
    db.prepare(
      `INSERT INTO clerk_escrows
       (guid, state, a_commodity, a_value, a_holding,
        b_commodity, b_value, b_holding)
       VALUES (?, 'open', ?, ?, ?, ?, ?, ?)`,
    ).run(
      escrowGuid,
      row.a_commodity,
      row.a_value,
      row.a_holding,
      row.b_commodity,
      row.b_value,
      row.b_holding,
    );
    return harden({
      a: provideSeat(escrowGuid, 'a'),
      b: provideSeat(escrowGuid, 'b'),
    });
  };

  /** for a sturdyref: the seat's escrow and side, and what it gives */
  const describeSeat = (obj: object) => {
    const id = seatIds.get(obj);
    if (!id) return undefined;
    const { commodity } = getSide(id.escrowGuid, id.side);
    return { commodityGuid: commodity, detail: `${id.escrowGuid}:${id.side}` };
  };

  return { makeEscrow, provideSeat, describeSeat };
};
