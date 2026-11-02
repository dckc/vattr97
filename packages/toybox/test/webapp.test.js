/** @file The WebApp kind's attenuation, in one process: liveslots over an in-memory vatstore, and a fetch device over a fake site. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, Far } from '@endo/far';
import { makeLiveslots } from '../liveslots.js';
import { makeFetchDevice } from '../devices/fetch.js';
import { M } from '@endo/patterns';
import { buildRootObject as buildWebApp } from '../kvats/webapp.js';
import { makeMemoryVatstore as makeKv } from './memory-vatstore.js';

/** @import { MapStore, Remote, SqlDatabase, Vatstore } from '../types.js' */

/** A db for vats that use none. */
const noDb = /** @type {SqlDatabase} */ (
  harden({
    exec: () => {
      throw Error('no db here');
    },
    prepare: () => {
      throw Error('no db here');
    },
  })
);

/**
 * site.example, answering with what it was asked; any other host gets the
 * 403 the switchboard gives outside a grant.
 *
 * @param {Request} request
 */
const echoSite = async request => {
  const { host, pathname, search } = new URL(request.url);
  if (host !== 'site.example')
    return new Response('egress refused', { status: 403 });
  const body = await request.text();
  return new Response(
    `${request.method} ${pathname}${search} cookie=${request.headers.get('cookie') ?? 'none'}${body && ` body=${body}`}`,
  );
};

/**
 * One incarnation of the webapp vat on `kv`, its egress a fetch device
 * over {@link echoSite}.
 *
 * @param {Vatstore} kv
 */
const incarnate = kv => {
  const send = () => Promise.reject(Error('this vat imports nothing'));
  const ls = makeLiveslots({ send, kv });
  const { zone } = ls;
  assert.ok(zone);
  const egress = makeFetchDevice(echoSite);
  /** @type {Remote} the maker's methods, as the vat defines them */
  const maker = buildWebApp(harden({ E, Far, M, zone, db: noDb }), { egress });
  /** @param {string} label @returns {MapStore<string, string>} */
  const store = label => zone.detached().mapStore(label);
  return { ls, store, maker };
};

test('pathjoin, query, withHeaders, and withHeaderMap narrow a WebApp; get and post send', async () => {
  const { store: newStore, maker } = incarnate(makeKv());
  const base = maker.makeWebApp('http://site.example/api/');
  assert.equal(await E(base).get(), 'GET /api/ cookie=none');
  const store = newStore('session');
  store.init('cookie', 'session=1');
  const app = base.withHeaderMap(store.readOnly());
  assert.equal(await E(app.pathjoin('a')).get(), 'GET /api/a cookie=session=1');
  assert.equal(
    await E(app.pathjoin('a/?x=1').pathjoin('b')).get(),
    'GET /api/a/b?x=1 cookie=session=1',
  );
  assert.equal(
    await E(app.query({ q: 1 })).get(),
    'GET /api/?q=1 cookie=session=1',
  );
  assert.equal(
    await E(app.pathjoin('p')).post('hi'),
    'POST /api/p cookie=session=1 body=hi',
  );
  assert.equal(
    await E(base.withHeaders({ cookie: 'a=b' })).get(),
    'GET /api/ cookie=a=b',
  );
});

test('a WebApp refuses to leave its path or contradict a header or query, naming keys only', async () => {
  const { store: newStore, maker } = incarnate(makeKv());
  const app = maker.makeWebApp('http://site.example/api/?q=secret');
  assert.throws(
    () => app.pathjoin('../admin'),
    /^Error: pathjoin: \/admin not within \/api\/$/,
  );
  assert.throws(() => app.query({ q: 2 }), /^Error: query: contradicts on q$/);
  assert.equal(
    await E(app.query({ q: 'secret' })).get(),
    'GET /api/?q=secret cookie=none',
  );
  const store = newStore('session');
  store.init('cookie', 'secret=1');
  const both = app
    .withHeaders({ cookie: 'other=1' })
    .withHeaderMap(store.readOnly());
  await assert.rejects(
    E(both).get(),
    /^Error: headers: contradicts on cookie$/,
  );
  assert.throws(
    () => app.withHeaders({ cookie: 'a' }).withHeaders({ cookie: 'b' }),
    /^Error: headers: contradicts on cookie$/,
  );
});

test("a header map is read at each send: rotating the store's cookie changes what handles already out send", async () => {
  const { store: newStore, maker } = incarnate(makeKv());
  const store = newStore('session');
  const app = maker
    .makeWebApp('http://site.example/')
    .withHeaderMap(store.readOnly());
  assert.equal(await E(app).get(), 'GET / cookie=none');
  store.init('cookie', 'session=1');
  assert.equal(await E(app).get(), 'GET / cookie=session=1');
  store.set('cookie', 'session=2');
  assert.equal(await E(app).get(), 'GET / cookie=session=2');
  // @ts-expect-error the read-only facet has no set, which is the point
  assert.equal(typeof store.readOnly().set, 'undefined');
});

test('a WebApp is durable: the next incarnation revives it with its URL, headers, and map', async () => {
  const kv = makeKv();
  const first = incarnate(kv);
  const store = first.store('session');
  store.init('cookie', 'session=1');
  const app = first.maker
    .makeWebApp('http://site.example/api/', { accept: 'text/plain' })
    .withHeaderMap(store.readOnly())
    .pathjoin('a');
  const [vref] = first.ls.serialize(app).slots;

  const second = incarnate(kv);
  const revived = second.ls.slotToVal(vref);
  assert.notEqual(revived, app);
  assert.equal(await E(revived).get(), 'GET /api/a cookie=session=1');
});

test('the egress decides where a WebApp may go', async () => {
  const { maker } = incarnate(makeKv());
  await assert.rejects(
    E(maker.makeWebApp('http://elsewhere.example/q?token=secret')).get(),
    /^Error: 403 on http:\/\/elsewhere\.example\/q$/,
  );
});
