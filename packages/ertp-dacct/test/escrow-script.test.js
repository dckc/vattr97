import test from 'ava';
import { Far } from '@endo/far';
import { makeTrader } from '../scripts/guests/trader.js';

test('trader creates purses and exposes only their sealed identities', async t => {
  const payment = Far('payment', {});
  const depositFacet = Far('deposit facet', {});
  const giveBrand = Far('give brand', {
    getAllegedName: () => 'USD',
  });
  const wantedBrand = Far('wanted brand', {
    getAllegedName: () => 'STOCK',
  });
  const refundPurse = Far('refund purse', {
    getDepositFacet: () => depositFacet,
    getCurrentAmount: () => harden({ brand: giveBrand, value: 0n }),
  });
  const wantPurse = Far('want purse', {
    getDepositFacet: () => depositFacet,
    getCurrentAmount: () => harden({ brand: wantedBrand, value: 10n }),
  });
  const giveIssuer = Far('give issuer', {
    makeEmptyPurse: () => refundPurse,
    getAmountOf: allegedPayment => {
      t.is(allegedPayment, payment);
      return harden({ brand: giveBrand, value: 100n });
    },
  });
  const wantIssuer = Far('want issuer', {
    makeEmptyPurse: () => wantPurse,
    getBrand: () => wantedBrand,
  });
  const namedPurses = new Map();
  const usdAccounts = Far('Alice USD accounts', {
    update: (name, sealedPurse) => {
      namedPurses.set(name, sealedPurse);
    },
  });
  const stockAccounts = Far('Alice STOCK accounts', {
    update: (name, sealedPurse) => {
      namedPurses.set(name, sealedPurse);
    },
  });
  const endowment = {
    give: {
      accountName: 'USD',
      issuer: giveIssuer,
      nameAdmin: usdAccounts,
      payment,
      sealer: Far('refund sealer', {
        seal: purse => harden({ kind: 'refund', purse }),
      }),
    },
    want: {
      accountName: 'STOCK',
      issuer: wantIssuer,
      nameAdmin: stockAccounts,
      value: 10n,
      sealer: Far('want sealer', {
        seal: purse => harden({ kind: 'want', purse }),
      }),
    },
  };
  Object.defineProperty(endowment, 'mint', {
    get: () => {
      throw Error('trader accessed mint authority');
    },
  });
  const trader = await makeTrader({
    env: { TRADER_NAME: 'Alice' },
  });

  const offer = await trader.makeOffer(endowment);
  const sealed = trader.getSealedPurses();
  t.is(await offer.give, payment);
  t.is(offer.want.brand, wantedBrand);
  t.deepEqual(trader.describeOffer(), {
    speaker: 'Alice',
    message:
      'I verified my payment, named my purses Alice/USD and Alice/STOCK, and prepared an offer of 100 USD for 10 STOCK.',
  });
  t.deepEqual(await trader.describeHoldings(), {
    speaker: 'Alice',
    message: 'My purses now hold 0 USD and 10 STOCK.',
  });
  t.deepEqual(sealed.refund, harden({ kind: 'refund', purse: refundPurse }));
  t.deepEqual(sealed.want, harden({ kind: 'want', purse: wantPurse }));
  t.deepEqual(namedPurses.get('USD'), sealed.refund);
  t.deepEqual(namedPurses.get('STOCK'), sealed.want);
});
