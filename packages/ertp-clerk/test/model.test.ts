/**
 * @file Model-based property tests of the ledger and escrow.
 *
 * Random sequences of operations, restarts included, run against both
 * the ledger and a reference model; after each step every purse
 * balance, payment, and escrow state must agree with the model. A second
 * property races operations on one escrow and checks offer safety and
 * conservation. See https://github.com/dckc/vattr97/issues/39
 *
 * The ledger is called in-process, without OCapN, so that runs are
 * cheap. The real side reaches every object by sturdyref, so a restart
 * drops nothing but live objects.
 *
 * FC_NUM_RUNS overrides the number of runs; a failure prints a seed and
 * path for fast-check's `seed` and `path` parameters.
 */
import { testProp, fc } from '@fast-check/ava';
import { E } from '@endo/far';
import Database from 'better-sqlite3';
import {
  initGnuCashSchema,
  wrapBetterSqlite3Database,
} from '@vattr/ertp-books/src/index.js';
import { mockMakeGuid } from '@vattr/ertp-books/src/guids.js';
import { makeLedger } from '../src/ledger.js';

const numRuns = Number(process.env.FC_NUM_RUNS) || undefined;

const COMMODITIES = ['USDC', 'STOCK'] as const;
type Commodity = (typeof COMMODITIES)[number];
const PARTIES = ['alice', 'bob', 'carol'] as const;
type Party = (typeof PARTIES)[number];
type Side = 'a' | 'b';
const SIDES = ['a', 'b'] as const;
const other = (side: Side): Side => (side === 'a' ? 'b' : 'a');

const purseKey = (party: Party, c: Commodity) => `${party}.${c}`;

type Model = {
  minted: Record<Commodity, bigint>;
  purses: Map<string, bigint>;
  payments: { commodity: Commodity; value: bigint; live: boolean }[];
  escrows: {
    /** what each side gives */
    gives: Record<Side, { commodity: Commodity; value: bigint }>;
    state: 'open' | 'settled' | 'cancelled';
    /** each side's refund and payout purses, once it has offered */
    offered: Partial<Record<Side, { refund: string; payout: string }>>;
  }[];
};

/** The ledger, reached only by swissnum. */
type Real = {
  get: (swissnum: string) => Promise<any>;
  ledger: () => any;
  restart: () => void;
  kits: Record<Commodity, { issuer: string; brand: string; mint: string }>;
  purses: Map<string, string>;
  payments: string[];
  seats: Record<Side, string>[];
};

const makeDb = () => {
  const db = wrapBetterSqlite3Database(new Database(':memory:'));
  initGnuCashSchema(db);
  return db;
};

const makeIO = () => {
  let now = Date.UTC(2026, 9, 10);
  let swissCount = 0;
  return {
    makeGuid: mockMakeGuid(),
    nowMs: () => (now += 1000),
    makeSwissnum: () => `swiss${(swissCount += 1)}`,
  };
};

const startLedger = async (): Promise<Real> => {
  const db = makeDb();
  const io = makeIO();
  let incarnation = makeLedger({ db, ...io });
  const ledger = () => incarnation.bootstrap;
  const sturdy = (obj: unknown) => E(ledger()).makeSturdyRef(obj as object);

  const kits = {} as Real['kits'];
  const purses = new Map<string, string>();
  for (const c of COMMODITIES) {
    const { issuer, brand, mint } = await E(ledger()).makeIssuerKit(c);
    kits[c] = {
      issuer: await sturdy(issuer),
      brand: await sturdy(brand),
      mint: await sturdy(mint),
    };
    for (const party of PARTIES) {
      purses.set(
        purseKey(party, c),
        await sturdy(await E(issuer).makeEmptyPurse()),
      );
    }
  }
  return {
    get: async swissnum => incarnation.swissnumTable.get(swissnum),
    ledger,
    restart: () => {
      incarnation = makeLedger({ db, ...io });
    },
    kits,
    purses,
    payments: [],
    seats: [],
  };
};

const emptyModel = (): Model => ({
  minted: { USDC: 0n, STOCK: 0n },
  purses: new Map(
    PARTIES.flatMap(p => COMMODITIES.map(c => [purseKey(p, c), 0n] as const)),
  ),
  payments: [],
  escrows: [],
});

const amount = async (real: Real, commodity: Commodity, value: bigint) =>
  harden({ brand: await real.get(real.kits[commodity].brand), value });

const fail = (msg: string) => {
  throw Error(msg);
};
const assertEqual = (actual: unknown, expected: unknown, what: string) => {
  if (actual !== expected) {
    fail(`${what}: expected ${expected}, got ${actual}`);
  }
};
/** run `thunk`, which must fail; with `pattern`, in that way */
const assertRejects = async (
  thunk: () => Promise<unknown>,
  what: string,
  pattern?: RegExp,
) => {
  try {
    await thunk();
  } catch (err) {
    const { message } = err as Error;
    if (pattern && !pattern.test(message)) {
      fail(`${what}: expected ${pattern}, got ${message}`);
    }
    return;
  }
  fail(`${what}: expected failure`);
};

/** Conservation, in the model: minted = purses + payments + escrow. */
const assertModelConserves = (m: Model) => {
  for (const c of COMMODITIES) {
    let total = 0n;
    for (const [key, value] of m.purses) {
      if (key.endsWith(`.${c}`)) total += value;
    }
    for (const p of m.payments) {
      if (p.live && p.commodity === c) total += p.value;
    }
    for (const e of m.escrows) {
      if (e.state !== 'open') continue;
      for (const side of SIDES) {
        if (e.offered[side] && e.gives[side].commodity === c) {
          total += e.gives[side].value;
        }
      }
    }
    assertEqual(total, m.minted[c], `${c} conserved in the model`);
  }
};

const isLive = async (real: Real, swissnum: string, c: Commodity) => {
  let payment;
  try {
    payment = await real.get(swissnum);
  } catch (err) {
    if ((err as Error).message === 'payment not live') return false;
    throw err;
  }
  return E(await real.get(real.kits[c].issuer)).isLive(payment);
};

/** Every observable of the ledger agrees with the model. */
const assertAgrees = async (m: Model, real: Real) => {
  assertModelConserves(m);
  for (const [key, expected] of m.purses) {
    const purse = await real.get(real.purses.get(key)!);
    const { value } = await E(purse).getCurrentAmount();
    assertEqual(value, expected, `balance of ${key}`);
  }
  for (const [i, p] of m.payments.entries()) {
    const live = await isLive(real, real.payments[i], p.commodity);
    assertEqual(live, p.live, `payment ${i} live`);
    if (!live) continue;
    const issuer = await real.get(real.kits[p.commodity].issuer);
    const { value } = await E(issuer).getAmountOf(
      await real.get(real.payments[i]),
    );
    assertEqual(value, p.value, `payment ${i} value`);
  }
  for (const [i, e] of m.escrows.entries()) {
    for (const side of SIDES) {
      const seat = await real.get(real.seats[i][side]);
      assertEqual(await E(seat).getState(), e.state, `escrow ${i}.${side}`);
    }
  }
};

/** A command whose `act` changes both the model and the ledger. */
const command = (
  label: string,
  act: (m: Model, real: Real) => Promise<void>,
  check: (m: Readonly<Model>) => boolean = () => true,
): fc.AsyncCommand<Model, Real> => ({
  check,
  run: async (m, real) => {
    await act(m, real);
    await assertAgrees(m, real);
  },
  toString: () => label,
});

const party = fc.constantFrom(...PARTIES);
const commodity = fc.constantFrom(...COMMODITIES);
const value = fc.bigInt({ min: 1n, max: 5n });
const index = fc.nat();
const side = fc.constantFrom(...SIDES);

const mint = fc
  .record({ party, commodity, value })
  .map(({ party: p, commodity: c, value: v }) =>
    command(`mint ${v} ${c} to ${p}`, async (m, real) => {
      const payment = await E(await real.get(real.kits[c].mint)).mintPayment(
        await amount(real, c, v),
      );
      await E(await real.get(real.purses.get(purseKey(p, c))!)).deposit(
        payment,
      );
      m.minted[c] += v;
      m.purses.set(purseKey(p, c), m.purses.get(purseKey(p, c))! + v);
    }),
  );

const withdraw = fc
  .record({ party, commodity, value })
  .map(({ party: p, commodity: c, value: v }) =>
    command(`withdraw ${v} ${c} from ${p}`, async (m, real) => {
      const key = purseKey(p, c);
      const purse = await real.get(real.purses.get(key)!);
      const balance = m.purses.get(key)!;
      const go = async () => E(purse).withdraw(await amount(real, c, v));
      if (v > balance) {
        await assertRejects(go, 'overdraft', /insufficient funds/);
        return;
      }
      const payment = await go();
      real.payments.push(await E(real.ledger()).makeSturdyRef(payment));
      m.payments.push({ commodity: c, value: v, live: true });
      m.purses.set(key, balance - v);
    }),
  );

const deposit = fc
  .record({ i: index, party, commodity })
  .map(({ i: n, party: p, commodity: c }) =>
    command(
      `deposit payment #${n} into ${p}'s ${c}`,
      async (m, real) => {
        const i = n % m.payments.length;
        const payment = m.payments[i];
        const key = purseKey(p, c);
        const purse = await real.get(real.purses.get(key)!);
        const go = async () =>
          E(purse).deposit(await real.get(real.payments[i]));
        if (!payment.live || payment.commodity !== c) {
          await assertRejects(go, 'deposit', /payment not live/);
          return;
        }
        await go();
        payment.live = false;
        m.purses.set(key, m.purses.get(key)! + payment.value);
      },
      m => m.payments.length > 0,
    ),
  );

const makeEscrow = fc
  .record({ a: commodity, aValue: value, b: commodity, bValue: value })
  .map(({ a, aValue, b, bValue }) =>
    command(`escrow ${aValue} ${a} for ${bValue} ${b}`, async (m, real) => {
      const seats = await E(real.ledger()).makeEscrow(
        await amount(real, a, aValue),
        await amount(real, b, bValue),
      );
      real.seats.push({
        a: await E(real.ledger()).makeSturdyRef(seats.a),
        b: await E(real.ledger()).makeSturdyRef(seats.b),
      });
      m.escrows.push({
        gives: {
          a: { commodity: a, value: aValue },
          b: { commodity: b, value: bValue },
        },
        state: 'open',
        offered: {},
      });
    }),
  );

/** what escrow `e` pays out to its sides, and how it settles */
const settle = (m: Model, e: Model['escrows'][number]) => {
  for (const s of SIDES) {
    const to = e.offered[other(s)]!.payout;
    m.purses.set(to, m.purses.get(to)! + e.gives[s].value);
  }
  e.state = 'settled';
};

/** side `s` of escrow `i` offers payment `j`, with `p`'s purses */
const offerAct = async (
  m: Model,
  real: Real,
  i: number,
  s: Side,
  j: number,
  p: Party,
) => {
  const e = m.escrows[i];
  const payment = m.payments[j];
  const give = e.gives[s];
  const refund = purseKey(p, give.commodity);
  const payout = purseKey(p, e.gives[other(s)].commodity);
  const go = async () =>
    E(await real.get(real.seats[i][s])).offer(
      await real.get(real.payments[j]),
      await real.get(real.purses.get(refund)!),
      await real.get(real.purses.get(payout)!),
    );
  if (e.state !== 'open') {
    // a dead payment's sturdyref fails before the offer reaches the seat
    const why = payment.live ? new RegExp(`escrow ${e.state}`) : undefined;
    await assertRejects(go, 'offer', why);
    return;
  }
  if (
    !payment.live ||
    payment.commodity !== give.commodity ||
    payment.value !== give.value ||
    e.offered[s]
  ) {
    await assertRejects(go, 'offer');
    return;
  }
  const state = await go();
  payment.live = false;
  e.offered[s] = { refund, payout };
  if (e.offered[other(s)]) settle(m, e);
  assertEqual(state, e.state, 'offer result');
};

const offer = fc
  .record({ e: index, side, pay: index, party })
  .map(({ e: en, side: s, pay: pn, party: p }) =>
    command(
      `escrow #${en}.${s} offers payment #${pn}, ${p}'s purses`,
      async (m, real) =>
        offerAct(m, real, en % m.escrows.length, s, pn % m.payments.length, p),
      m => m.escrows.length > 0 && m.payments.length > 0,
    ),
  );

/** Random payments rarely match an escrow, so also offer a fresh one. */
const offerExact = fc
  .record({ e: index, side, party })
  .map(({ e: en, side: s, party: p }) =>
    command(
      `escrow #${en}.${s} offers what it gives, minted for ${p}`,
      async (m, real) => {
        const i = en % m.escrows.length;
        const { commodity: c, value: v } = m.escrows[i].gives[s];
        const payment = await E(await real.get(real.kits[c].mint)).mintPayment(
          await amount(real, c, v),
        );
        real.payments.push(await E(real.ledger()).makeSturdyRef(payment));
        m.minted[c] += v;
        m.payments.push({ commodity: c, value: v, live: true });
        await offerAct(m, real, i, s, m.payments.length - 1, p);
      },
      m => m.escrows.length > 0,
    ),
  );

const cancel = fc.record({ e: index, side }).map(({ e: en, side: s }) =>
  command(
    `escrow #${en}.${s} cancels`,
    async (m, real) => {
      const i = en % m.escrows.length;
      const e = m.escrows[i];
      const go = async () => E(await real.get(real.seats[i][s])).cancel();
      if (e.state !== 'open') {
        await assertRejects(go, 'cancel', new RegExp(`escrow ${e.state}`));
        return;
      }
      await go();
      for (const t of SIDES) {
        const offered = e.offered[t];
        if (!offered) continue;
        m.purses.set(
          offered.refund,
          m.purses.get(offered.refund)! + e.gives[t].value,
        );
      }
      e.state = 'cancelled';
    },
    m => m.escrows.length > 0,
  ),
);

const restart = fc.constant(
  command('restart', async (_m, real) => real.restart()),
);

testProp(
  'the ledger agrees with the model, across restarts',
  [
    fc.commands(
      [mint, withdraw, deposit, makeEscrow, offer, offerExact, cancel, restart],
      { maxCommands: 40 },
    ),
  ],
  async (t, cmds) => {
    const real = await startLedger();
    await fc.asyncModelRun(async () => ({ model: emptyModel(), real }), cmds);
    t.pass();
  },
  { numRuns },
);

/**
 * Alice gives 300 USDC for Bob's 3 STOCK. Each operation below is
 * prepared in advance, then all start in the same turn, each after
 * its own number of microtask ticks, so that one can land between
 * another's check and its `await`. No restarts here: a Durable Object
 * restart ends the old incarnation's work, while two incarnations of
 * this in-process ledger would run side by side.
 */
const RACE_OPS = [
  'offerA',
  'offerA again',
  'offerA short',
  'offerB',
  'offerB again',
  'cancelA',
  'cancelB',
] as const;

testProp(
  'racing offers and cancels keep offer safety and conservation',
  [
    fc.subarray([...RACE_OPS], { minLength: 1 }),
    fc.array(fc.nat({ max: 12 }), {
      minLength: RACE_OPS.length,
      maxLength: RACE_OPS.length,
    }),
    fc.boolean(),
  ],
  async (t, ops, delays, refundToFacet) => {
    const real = await startLedger();
    const purse = async (p: Party, c: Commodity) =>
      real.get(real.purses.get(purseKey(p, c))!);
    const fund = async (p: Party, c: Commodity, v: bigint) =>
      E(await purse(p, c)).deposit(
        await E(await real.get(real.kits[c].mint)).mintPayment(
          await amount(real, c, v),
        ),
      );
    await fund('alice', 'USDC', 1000n);
    await fund('bob', 'STOCK', 10n);
    const seats = await E(real.ledger()).makeEscrow(
      await amount(real, 'USDC', 300n),
      await amount(real, 'STOCK', 3n),
    );
    const seatSwiss = {
      a: await E(real.ledger()).makeSturdyRef(seats.a),
      b: await E(real.ledger()).makeSturdyRef(seats.b),
    };

    /** a payment withdrawn now, kept by sturdyref */
    const withdrawn = async (p: Party, c: Commodity, v: bigint) =>
      E(real.ledger()).makeSturdyRef(
        await E(await purse(p, c)).withdraw(await amount(real, c, v)),
      );
    const offerWith = async (
      s2: Side,
      p: Party,
      paymentSwiss: string,
      give: Commodity,
      want: Commodity,
    ) => {
      const refund = await purse(p, give);
      return E(await real.get(seatSwiss[s2])).offer(
        await real.get(paymentSwiss),
        refundToFacet ? await E(refund).getDepositFacet() : refund,
        await purse(p, want),
      );
    };

    const run: Record<(typeof RACE_OPS)[number], () => Promise<unknown>> =
      {} as any;
    const outstanding: { p: Party; c: Commodity; swiss: string }[] = [];
    for (const op of ops) {
      const [p, give, want, s2, v]: [
        Party,
        Commodity,
        Commodity,
        Side,
        bigint,
      ] = op.startsWith('offerA')
        ? ['alice', 'USDC', 'STOCK', 'a', op.endsWith('short') ? 299n : 300n]
        : ['bob', 'STOCK', 'USDC', 'b', 3n];
      if (op.startsWith('offer')) {
        const swiss = await withdrawn(p, give, v);
        outstanding.push({ p, c: give, swiss });
        run[op] = () => offerWith(s2, p, swiss, give, want);
      } else {
        const s3 = op === 'cancelA' ? 'a' : 'b';
        run[op] = async () => E(await real.get(seatSwiss[s3])).cancel();
      }
    }

    const after = async (ticks: number) => {
      for (let n = 0; n < ticks; n += 1) await null;
    };
    const results = await Promise.allSettled(
      ops.map((op, i) => after(delays[i]).then(() => run[op]())),
    );
    const outcome = new Map(ops.map((op, i) => [op, results[i]]));
    const ok = (op: string) => outcome.get(op as never)?.status === 'fulfilled';

    const offers = { a: 0, b: 0 };
    for (const op of ops) {
      if (op.startsWith('offer') && ok(op)) offers[op[5] === 'A' ? 'a' : 'b']++;
    }
    t.true(offers.a <= 1 && offers.b <= 1, 'one offer per side');
    t.false(ok('offerA short'), 'a short offer never succeeds');

    const seatA = await real.get(seatSwiss.a);
    const state = await E(seatA).getState();
    const cancelled = ok('cancelA') || ok('cancelB');
    t.is(state === 'cancelled', cancelled, 'cancelled iff a cancel succeeded');
    t.is(
      state === 'settled',
      offers.a === 1 && offers.b === 1 && !cancelled,
      'settled iff both offered before any cancel',
    );
    if (state === 'open') await E(seatA).cancel();

    // conservation and offer safety: count each party's holdings,
    // including payments withdrawn for offers that were refused
    const holdings = async (p: Party) => {
      const total: Record<Commodity, bigint> = { USDC: 0n, STOCK: 0n };
      for (const c of COMMODITIES) {
        total[c] += (await E(await purse(p, c)).getCurrentAmount()).value;
      }
      for (const { p: q, c, swiss } of outstanding) {
        if (q !== p) continue;
        if (await isLive(real, swiss, c)) {
          const issuer = await real.get(real.kits[c].issuer);
          total[c] += (
            await E(issuer).getAmountOf(await real.get(swiss))
          ).value;
        }
      }
      return total;
    };
    const alice = await holdings('alice');
    const bob = await holdings('bob');
    t.is(alice.USDC + bob.USDC, 1000n, 'USDC conserved');
    t.is(alice.STOCK + bob.STOCK, 10n, 'STOCK conserved');
    if (state === 'settled') {
      t.deepEqual(alice, { USDC: 700n, STOCK: 3n });
      t.deepEqual(bob, { USDC: 300n, STOCK: 7n });
    } else {
      t.deepEqual(alice, { USDC: 1000n, STOCK: 0n }, 'alice made whole');
      t.deepEqual(bob, { USDC: 0n, STOCK: 10n }, 'bob made whole');
    }
  },
  { numRuns },
);
