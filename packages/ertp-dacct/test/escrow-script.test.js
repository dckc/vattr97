import test from 'ava';
import { E } from '@endo/eventual-send';
import { Far } from '@endo/far';
import { makeTrader } from '../scripts/guests/trader.js';

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
    give: {
      issuer: giveIssuer,
      payment,
      sealer: Far('refund sealer', {
        seal: purse => harden({ kind: 'refund', purse }),
      }),
    },
    want: {
      issuer: wantIssuer,
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
  const powers = Far('powers', {
    lookup: name => {
      t.is(name, 'trader-kit');
      return endowment;
    },
  });
  const trader = await makeTrader(
    { eventualSend: E, makeFar: Far },
    powers,
    {
      env: { TRADER_NAME: 'Alice' },
    },
  );

  const offer = await trader.makeOffer();
  const sealed = trader.getSealedPurses();
  t.is(await offer.give, payment);
  t.is(offer.want.brand, wantedBrand);
  t.deepEqual(sealed.refund, harden({ kind: 'refund', purse: refundPurse }));
  t.deepEqual(sealed.want, harden({ kind: 'want', purse: wantPurse }));
});
