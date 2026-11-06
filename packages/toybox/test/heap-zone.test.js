/** @file A heap zone has a vat's zone's kinds and stores, with the same defaults. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHeapZone } from '../src/vat/heap-zone.js';
import { makeLiveslots } from '../src/vat/liveslots.js';
import { makeMemoryVatstore } from './memory-vatstore.js';

/** @import { Zone } from '../src/types.js' */

/** @type {Record<string, () => Zone>} */
const zones = {
  heap: makeHeapZone,
  durable: () => {
    const send = () => Promise.reject(Error('no kernel here'));
    const { zone } = makeLiveslots({ send, kv: makeMemoryVatstore() });
    assert.ok(zone);
    return zone;
  },
};

test('a heap zone makes once, keeps stores by name, and hands out read-only facets', () => {
  const zone = makeHeapZone();
  let made = 0;
  const first = zone.makeOnce('x', () => (made += 1));
  assert.equal(
    zone.makeOnce('x', () => (made += 1)),
    first,
  );
  assert.equal(made, 1);

  const store = zone.mapStore('s');
  assert.equal(zone.mapStore('s'), store);
  store.init('a', 1);
  assert.throws(() => store.init('a', 2), /key already in s/);
  assert.throws(() => store.set('b', 2), /no such key in s/);
  const ro = store.readOnly();
  assert.equal(ro.get('a'), 1);
  assert.equal(/** @type {any} */ (ro).init, undefined);
  const other = zone.detached().mapStore('s');
  assert.notEqual(other, zone.detached().mapStore('s'));
  assert.equal(other.has('a'), false);
});

test("a heap zone's kinds keep state, and an async method answers through the default guard", async () => {
  const zone = makeHeapZone();
  const makeCounter = zone.exoClass('Counter', undefined, () => ({ n: 0 }), {
    async incr() {
      this.state.n += 1;
      return this.state.n;
    },
  });
  const counter = makeCounter();
  assert.equal(await counter.incr(), 1);
  assert.equal(await counter.incr(), 2);
  const { up, read } = zone.exoClassKit('Kit', undefined, () => ({ n: 0 }), {
    up: {
      up() {
        this.state.n += 1;
      },
    },
    read: {
      read() {
        return this.state.n;
      },
    },
  })();
  up.up();
  assert.equal(read.read(), 1);
  assert.equal(zone.exo('One', undefined, {}), zone.exo('One', undefined, {}));
});

for (const [name, makeZone] of Object.entries(zones)) {
  test(`in a ${name} zone, sub-zones keep their names apart`, () => {
    const zone = makeZone();
    const mia = zone.subZone('Mia');
    const lena = zone.subZone('Lena');
    assert.equal(
      mia.makeOnce('x', () => 'hers'),
      'hers',
    );
    assert.equal(
      lena.makeOnce('x', () => 'Lena'),
      'Lena',
    );
    assert.equal(
      zone.subZone('Mia').makeOnce('x', () => 'again'),
      'hers',
    );
    const stores = [
      zone.mapStore('s'),
      mia.mapStore('s'),
      lena.mapStore('s'),
      mia.subZone('Lena').mapStore('s'),
    ];
    assert.equal(new Set(stores).size, 4);
    assert.equal(zone.subZone('Mia').mapStore('s'), stores[1]);
    const who = (/** @type {Zone} */ z, /** @type {string} */ me) =>
      z.exo('Who', undefined, { who: () => me }).who();
    assert.deepEqual([who(mia, 'Mia'), who(lena, 'Lena')], ['Mia', 'Lena']);
    assert.equal(
      String(mia.exo('Who', undefined, {})),
      '[object Alleged: Who]',
      "a kind's objects show its tag, not the sub-zone's path",
    );
    assert.throws(() => zone.subZone('Mia/x'), /without '\/'/);
    assert.throws(() => zone.subZone(''), /non-empty/);
  });

  test(`in a ${name} zone, a kind given no guard takes and answers only passables`, () => {
    const zone = makeZone();
    const echo = zone.exo('Echo', undefined, {
      /** @param {unknown} x */
      echo: x => x,
      leak: () => () => 1,
    });
    assert.deepEqual(echo.echo(harden({ a: 1 })), { a: 1 });
    assert.throws(
      () => echo.echo(() => 1),
      /Remotables must be explicitly declared/,
    );
    assert.throws(
      () => echo.leak(),
      /result: .*Remotables must be explicitly declared/,
    );
    const { up } = zone.exoClassKit('Kit', undefined, () => ({}), {
      up: { /** @param {unknown} x */ up: x => x },
      down: {},
    })();
    assert.throws(
      () => up.up(() => 1),
      /Remotables must be explicitly declared/,
    );
  });
}
