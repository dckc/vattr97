// @ts-check

// Endo confined workers endow these globals; importing them would enlarge the archive.
/* global E, Far, harden */

/**
 * Alice and Bob run separate instances of this confined guest program.
 * Each receives its offer terms directly when asked to make an offer.
 *
 * @param {{ env: Record<string, string> }} options
 */
export const makeTrader = async ({ env }) => {
  const name = env.TRADER_NAME;
  if (!name) {
    throw Error('TRADER_NAME is required');
  }

  let offerMade = false;
  let sealedPurses;
  let purses;
  let offerReport;

  return Far(`${name} trader`, {
    async makeOffer({ give: giveSpec, want: wantSpec }) {
      if (offerMade) {
        throw Error(`${name} already made an offer`);
      }
      offerMade = true;

      const [refundPurse, wantPurse, wantBrand, giveAmount] =
        await Promise.all([
          E(giveSpec.issuer).makeEmptyPurse(),
          E(wantSpec.issuer).makeEmptyPurse(),
          E(wantSpec.issuer).getBrand(),
          E(giveSpec.issuer).getAmountOf(giveSpec.payment),
        ]);
      const [
        refundDeposit,
        wantDeposit,
        sealedRefund,
        sealedWant,
        giveLabel,
        wantLabel,
      ] = await Promise.all([
        E(refundPurse).getDepositFacet(),
        E(wantPurse).getDepositFacet(),
        E(giveSpec.sealer).seal(refundPurse),
        E(wantSpec.sealer).seal(wantPurse),
        E(giveAmount.brand).getAllegedName(),
        E(wantBrand).getAllegedName(),
      ]);
      sealedPurses = harden({
        refund: sealedRefund,
        want: sealedWant,
      });
      await Promise.all([
        E(giveSpec.nameAdmin).update(
          giveSpec.accountName,
          sealedRefund,
        ),
        E(wantSpec.nameAdmin).update(
          wantSpec.accountName,
          sealedWant,
        ),
      ]);
      const refundPath = harden([name, giveSpec.accountName]);
      const wantPath = harden([name, wantSpec.accountName]);
      purses = harden({
        refund: refundPurse,
        want: wantPurse,
        giveLabel,
        wantLabel,
      });
      offerReport = harden({
        speaker: name,
        message: `I verified my payment, named my purses ${refundPath.join('/')} and ${wantPath.join('/')}, and prepared an offer of ${giveAmount.value} ${giveLabel} for ${wantSpec.value} ${wantLabel}.`,
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
    describeOffer() {
      if (!offerReport) {
        throw Error(`${name} has not made an offer`);
      }
      return offerReport;
    },
    async describeHoldings() {
      if (!purses) {
        throw Error(`${name} has not made an offer`);
      }
      const [refundAmount, wantAmount] = await Promise.all([
        E(purses.refund).getCurrentAmount(),
        E(purses.want).getCurrentAmount(),
      ]);
      return harden({
        speaker: name,
        message: `My purses now hold ${refundAmount.value} ${purses.giveLabel} and ${wantAmount.value} ${purses.wantLabel}.`,
      });
    },
  });
};

export const make = (_powers, _context, options) =>
  makeTrader(options);
harden(make);
