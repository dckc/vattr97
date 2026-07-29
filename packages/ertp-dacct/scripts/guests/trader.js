// @ts-check

/* global E, Far, harden */

/**
 * Alice and Bob run separate instances of this confined guest program.
 * Their private name hubs contain only their respective `trader-kit`.
 *
 * @param {{ lookup: (name: string) => unknown }} powers
 * @param {unknown} _context
 * @param {{ env: Record<string, string> }} options
 */
export const makeTrader = async (
  { eventualSend, makeFar },
  powers,
  { env },
) => {
  const name = env.TRADER_NAME;
  if (!name) {
    throw Error('TRADER_NAME is required');
  }

  const { give: giveSpec, want: wantSpec } =
    await eventualSend(powers).lookup('trader-kit');
  let offerMade = false;
  let sealedPurses;

  return makeFar(`${name} trader`, {
    async makeOffer() {
      if (offerMade) {
        throw Error(`${name} already made an offer`);
      }
      offerMade = true;

      const [refundPurse, wantPurse, wantBrand] = await Promise.all([
        eventualSend(giveSpec.issuer).makeEmptyPurse(),
        eventualSend(wantSpec.issuer).makeEmptyPurse(),
        eventualSend(wantSpec.issuer).getBrand(),
      ]);
      const [refundDeposit, wantDeposit, sealedRefund, sealedWant] =
        await Promise.all([
          eventualSend(refundPurse).getDepositFacet(),
          eventualSend(wantPurse).getDepositFacet(),
          eventualSend(giveSpec.sealer).seal(refundPurse),
          eventualSend(wantSpec.sealer).seal(wantPurse),
        ]);
      sealedPurses = harden({
        refund: sealedRefund,
        want: sealedWant,
      });

      return harden({
        give: Promise.resolve(giveSpec.payment),
        want: harden({ brand: wantBrand, value: wantSpec.value }),
        payouts: harden({ refund: refundDeposit, want: wantDeposit }),
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

export const make = (powers, _context, options) =>
  makeTrader({ eventualSend: E, makeFar: Far }, powers, options);
harden(make);
