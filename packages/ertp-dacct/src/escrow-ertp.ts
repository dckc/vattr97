import { E } from '@endo/eventual-send';
import type { ERef } from '@endo/eventual-send';
import type {
  AssetKind,
  DepositFacet,
  Issuer,
  Payment,
  Purse,
  Amount,
} from './ertp-types.ts';
import { defaultZone } from './jessie-tools.ts';
import type { Zone } from './jessie-tools.ts';

const { freeze } = Object;

export type Sealer = Readonly<{ seal: (obj: object) => object }>;

export type EscrowParty<
  GiveKind extends AssetKind,
  WantKind extends AssetKind,
> = {
  give: Promise<Payment<GiveKind>>;
  want: Amount<WantKind>;
  payouts: {
    refund: DepositFacet<GiveKind>;
    want: DepositFacet<WantKind>;
  };
  cancellationP: Promise<unknown>;
};

const failOnly = (cancellationP: Promise<unknown>) =>
  Promise.resolve(cancellationP).then(cancellation => {
    throw cancellation;
  });

export const makeErtpEscrow = async <
  KindA extends AssetKind = AssetKind,
  KindB extends AssetKind = AssetKind,
>({
  issuers,
  zone = defaultZone,
  sealers,
}: {
  issuers: { A: ERef<Issuer<KindA>>; B: ERef<Issuer<KindB>> };
  zone?: Zone;
  sealers?: { A: Sealer; B: Sealer };
}) => {
  const { exo } = zone;
  const escrows: { A: Purse<KindA>; B: Purse<KindB> } = {
    A: await E(issuers.A).makeEmptyPurse(),
    B: await E(issuers.B).makeEmptyPurse(),
  };

  const escrowExchange = (
    a: EscrowParty<KindA, KindB>,
    b: EscrowParty<KindB, KindA>,
  ) => {
    const depositPs = {
      A: Promise.resolve(a.give).then(payment =>
        E(escrows.A).deposit(payment),
      ),
      B: Promise.resolve(b.give).then(payment =>
        E(escrows.B).deposit(payment),
      ),
    };
    const depositsP: Promise<{ A: Amount<KindA>; B: Amount<KindB> }> =
      Promise.all([depositPs.A, depositPs.B]).then(([A, B]) => ({ A, B }));
    const depositsSettledP: Promise<{
      A: PromiseSettledResult<Amount<KindA>>;
      B: PromiseSettledResult<Amount<KindB>>;
    }> = Promise.allSettled([depositPs.A, depositPs.B]).then(([A, B]) => ({
      A,
      B,
    }));
    const decisionP = Promise.race([
      depositsP,
      failOnly(a.cancellationP),
      failOnly(b.cancellationP),
    ]);
    const payoutOne = <K extends AssetKind>(
      payout: DepositFacet<K>,
      escrow: Purse<K>,
      amount: Amount<K>,
    ) =>
      Promise.resolve()
        .then(() => E(escrow).withdraw(amount))
        .then(payment => E(payout).receive(payment));
    const assertEnough = <K extends AssetKind>(
      have: Amount<K>,
      want: Amount<K>,
      who: string,
    ) => {
      if (have.brand !== want.brand) {
        throw new Error(`amount brand mismatch: ${who}`);
      }
      if (have.value < want.value) {
        throw new Error(`insufficient offer: ${who}`);
      }
    };
    const payoutBoth = (
      payouts: { A: DepositFacet<KindA>; B: DepositFacet<KindB> },
      amounts: { A: Amount<KindA>; B: Amount<KindB> },
    ) =>
      Promise.all([
        payoutOne(payouts.A, escrows.A, amounts.A),
        payoutOne(payouts.B, escrows.B, amounts.B),
      ]);
    return decisionP.then(
      amounts => {
        try {
          assertEnough(amounts.A, b.want, 'party A');
          assertEnough(amounts.B, a.want, 'party B');
        } catch (error) {
          return payoutBoth(
            { A: a.payouts.refund, B: b.payouts.refund },
            amounts,
          ).then(() => {
            throw error;
          });
        }
        return payoutBoth({ A: b.payouts.want, B: a.payouts.want }, amounts);
      },
      error =>
        depositsSettledP.then(settled => {
          const refunds: Promise<unknown>[] = [];
          if (settled.A.status === 'fulfilled') {
            refunds.push(
              payoutOne(a.payouts.refund, escrows.A, settled.A.value),
            );
          }
          if (settled.B.status === 'fulfilled') {
            refunds.push(
              payoutOne(b.payouts.refund, escrows.B, settled.B.value),
            );
          }
          return Promise.all(refunds).then(() => {
            throw error;
          });
        }),
    );
  };

  return freeze({
    escrowExchange,
    getSealedPurses: () => {
      if (!sealers) throw new Error('sealers not provided');
      return freeze({
        A: sealers.A.seal(escrows.A),
        B: sealers.B.seal(escrows.B),
      });
    },
  });
};
