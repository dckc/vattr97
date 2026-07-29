import test from 'ava';
import { Far } from '@endo/far';
import { makeTraderActor } from '../scripts/escrow-ertp.js';

test('trader creates purses and exposes only their sealed identities', async t => {
  const payment = Far('payment', {});
  const depositFacet = Far('deposit facet', {});
  const refundPurse = Far('refund purse', {
    getDepositFacet: () => depositFacet,
  });
  const wantPurse = Far('want purse', {
    getDepositFacet: () => depositFacet,
  });
  const wantedBrand = Far('wanted brand', {});
  const giveIssuer = Far('give issuer', {
    makeEmptyPurse: () => refundPurse,
  });
  const wantIssuer = Far('want issuer', {
    makeEmptyPurse: () => wantPurse,
    getBrand: () => wantedBrand,
  });
  const endowment = {
    name: 'Alice',
    giveIssuer,
    wantIssuer,
    givePayment: payment,
    wantValue: 10n,
    sealGivePurse: purse => harden({ kind: 'refund', purse }),
    sealWantPurse: purse => harden({ kind: 'want', purse }),
  };
  Object.defineProperty(endowment, 'mint', {
    get: () => {
      throw Error('trader accessed mint authority');
    },
  });
  const trader = makeTraderActor(endowment);

  const offer = await trader.makeOffer();
  const sealed = trader.getSealedPurses();
  t.is(await offer.give, payment);
  t.is(offer.want.brand, wantedBrand);
  t.deepEqual(sealed.refund, harden({ kind: 'refund', purse: refundPurse }));
  t.deepEqual(sealed.want, harden({ kind: 'want', purse: wantPurse }));
});
