/** @file A vat's liveslots on its own: durable kinds, read from a vatstore written by earlier code. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLiveslots } from '../liveslots.js';
import { makeMemoryVatstore as makeKv } from './memory-vatstore.js';

/** @import { Vatstore, Zone } from '../types.js' */

const send = () => Promise.reject(Error('no kernel here'));

/** The zone of liveslots made on `kv`. @param {Vatstore} kv */
const zoneOn = kv => {
  const ls = makeLiveslots({ send, kv });
  assert.ok(ls.zone);
  return { zone: ls.zone, slotToVal: ls.slotToVal };
};

/** A vatstore as liveslots wrote it before kits: one Counter, count 5, and no `kindFacets.` key. */
const beforeKits = () =>
  makeKv({
    'kind.next': '1',
    'kind.Counter': '1',
    'vom.next.1': '1',
    'vom.o+d1/1': JSON.stringify({ body: '#{"count":5}', slots: [] }),
  });

const counterMethods = {
  /** @this {{ state: { count: number } }} */
  incr() {
    this.state.count += 1;
    return this.state.count;
  },
};

test('a kind stored before kits revives as one facet, under its old vref', () => {
  const { zone, slotToVal } = zoneOn(beforeKits());
  zone.exoClass('Counter', undefined, () => ({ count: 0 }), counterMethods);
  assert.equal(slotToVal('o+d1/1').incr(), 6);
  assert.throws(() => slotToVal('o+d1/1:self'), /no such facet/);
});

test('a kind stored before kits may not become a kit', () => {
  const { zone } = zoneOn(beforeKits());
  assert.throws(
    () =>
      zone.exoClassKit('Counter', undefined, () => ({ count: 0 }), {
        incr: counterMethods,
        read: { read: () => 0 },
      }),
    /kind Counter had facets self; it can't have \["incr","read"\] now/,
  );
});

test("a kit's facets revive together, sharing state; each keeps its own vref", () => {
  const kv = makeKv();
  /** @param {Zone} zone */
  const define = zone =>
    zone.exoClassKit('Pair', undefined, () => ({ n: 0 }), {
      up: {
        up() {
          this.state.n += 1;
          return this.facets.down;
        },
      },
      down: {
        n() {
          return this.state.n;
        },
      },
    });
  const first = zoneOn(kv);
  const { up } = define(first.zone)();
  up.up();
  // a later incarnation, on the same vatstore
  const later = zoneOn(kv);
  define(later.zone);
  const down = later.slotToVal('o+d1/1:down');
  assert.equal(down.n(), 1);
  assert.equal(later.slotToVal('o+d1/1:up').up(), down);
  assert.equal(down.n(), 2);
  assert.throws(() => later.slotToVal('o+d1/1'), /no such facet/);
  assert.throws(() => later.slotToVal('o+d1/1:sideways'), /no such facet/);
});

test('a delivery reaches only the methods an object defines, not what every object inherits', async () => {
  const { serialize, deliver, setRoot } = makeLiveslots({ send, kv: makeKv() });
  setRoot(harden({ hi: () => 'hi' }));
  const none = serialize(harden([]));
  assert.deepEqual(await deliver('o+0', 'hi', none), serialize('hi'));
  for (const method of ['toString', 'constructor', 'hasOwnProperty'])
    await assert.rejects(deliver('o+0', method, none), /no method/);
});

test(
  'a kind tagged `next` keeps its objects across incarnations',
  {
    todo: 'FIXME in liveslots.js: `kind.next` is also the kind counter',
  },
  () => {
    const kv = makeKv();
    /** @param {Zone} zone */
    const define = zone => {
      const make = zone.exoClass(
        'next',
        undefined,
        () => ({ count: 0 }),
        counterMethods,
      );
      // a kind defined after it moves the counter its id is read from
      zone.exoClass('Other', undefined, () => ({ count: 0 }), counterMethods);
      return zone.makeOnce('kept', () => make());
    };
    assert.equal(define(zoneOn(kv).zone).incr(), 1);
    assert.equal(define(zoneOn(kv).zone).incr(), 2);
  },
);

test(
  'a store named `a` holds only its own entries, not those of one named `a.b`',
  {
    todo: 'FIXME in liveslots.js: store ids are prefixes of each other',
  },
  () => {
    const { zone } = zoneOn(makeKv());
    const a = zone.mapStore('a');
    zone.mapStore('a.b').init('x', 1);
    assert.equal(a.getSize(), 0);
    assert.deepEqual(a.keys(), []);
  },
);
