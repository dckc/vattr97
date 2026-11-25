/** @file The WebApp kind's attenuation, in one process: liveslots over an in-memory vatstore, and a fetch device over a fake site. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, Far } from '@endo/far';
import { makeLiveslots } from '../src/vat/liveslots.js';
import { makeFetchDevice } from '../src/devices/fetch.js';
import { M } from '@endo/patterns';
import { buildRootObject as buildWebApp } from '../examples/webapp.js';
import { makeMemoryVatstore as makeKv } from './memory-vatstore.js';
import { hashes } from '../src/hashes.js';

/** @import { MapStore, Remote, SqlDatabase } from '../src/types.js' */
/** @import { Vatstore } from '../src/vat/types.js' */

/** A db for vats that use none. */
const noDb = /** @type {SqlDatabase} */ (
  harden({
    exec: () => {
      throw Error('no db here');
    },
    transaction: () => {
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
  const endowment = () => {
    throw Error('no endowments here');
  };
  const powers = harden({
    E,
    Far,
    M,
    zone,
    hashes,
    stdlib: harden({ E, Far, M, hashes }),
    db: noDb,
    endowment,
  });
  /** @type {Remote} the maker's methods, as the vat defines them */
  const maker = buildWebApp(powers, { egress });
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

test("a WebApp sends and answers bodies bigger than a pattern's default string limit", async () => {
  // diigo's page of bookmarks passes 100,000 characters
  const { maker } = incarnate(makeKv());
  const big = 'x'.repeat(200_000);
  const answer = await E(maker.makeWebApp('http://site.example/api/')).post(
    big,
  );
  assert.equal(
    answer.length,
    'POST /api/ cookie=none body='.length + big.length,
  );
});

test('a WebApp refuses to leave its path or contradict a header or query, naming keys only', async () => {
  const { store: newStore, maker } = incarnate(makeKv());
  const app = maker.makeWebApp('http://site.example/api/?q=secret');
  assert.throws(
    () => app.pathjoin('../admin'),
    /^Error: pathjoin: \/admin not within \/api\/$/,
  );
  const v1 = maker.makeWebApp('http://site.example/api/v1');
  assert.equal(await E(v1.pathjoin('v1/x')).get(), 'GET /api/v1/x cookie=none');
  for (const ref of ['v1-admin', '/api/v1x', '//other@site.example/api/v1/x'])
    assert.throws(() => v1.pathjoin(ref), /^Error: pathjoin: .* not within/);
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
  assert.throws(
    () => app.withHeaders({ Cookie: 'a' }).withHeaders({ cookie: 'b' }),
    /^Error: headers: contradicts on cookie$/,
  );
  // a header's value is a string
  assert.throws(() => app.withHeaders({ cookie: 1 }), /cookie/);
  // pathjoin takes a string
  assert.throws(() => app.pathjoin({ toString: () => '../admin' }));
  // a name every object inherits is a header name like any other
  app.withHeaders({ constructor: 'x' }).withHeaders({ toString: 'y' });
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
    E(maker.makeWebApp('http://elsewhere.example/q?token=secret#key')).get(),
    // what the site said, so a failure says why; not the query
    /^Error: 403 on http:\/\/elsewhere\.example\/q: egress refused$/,
  );
  assert.throws(
    () => maker.makeWebApp('http://me:pw@site.example/'),
    /^Error: makeWebApp: a URL has no credentials; send them as a header$/,
  );
});

/**
 * site.example, parsing a multipart/form-data POST as a browser's server
 * would, and answering with the fields it got, in order.
 *
 * @param {Request} request
 */
const formSite = async request => {
  const type = request.headers.get('content-type') ?? '';
  if (!type.startsWith('multipart/form-data; boundary='))
    return new Response(`not a form: ${type}`, { status: 415 });
  const form = await request.formData();
  return new Response(
    [...form.entries()].map(([k, v]) => `${k}=${v}`).join('&'),
  );
};

test('postForm sends multipart/form-data: its fields, and each form map as of the send', async () => {
  const kv = makeKv();
  const ls = makeLiveslots({
    send: () => Promise.reject(Error('this vat imports nothing')),
    kv,
  });
  const { zone } = ls;
  assert.ok(zone);
  const endowment = () => {
    throw Error('no endowments here');
  };
  const powers = harden({
    E,
    Far,
    M,
    zone,
    hashes,
    stdlib: harden({ E, Far, M, hashes }),
    db: noDb,
    endowment,
  });
  /** @type {Remote} */
  const maker = buildWebApp(powers, { egress: makeFetchDevice(formSite) });
  /** @type {MapStore<string, string>} */
  const session = zone.detached().mapStore('session');
  const app = maker
    .makeWebApp('http://site.example/export/')
    .withFormMap(session.readOnly());
  assert.equal(await E(app).postForm({ fmt: 'ofx' }), 'fmt=ofx');
  session.init('token', 't-1');
  // narrowing keeps the form map; a value can hold anything but the boundary
  const derived = app.pathjoin('42').query({ from: '2026-08-13\x1f' });
  assert.equal(
    await E(derived).postForm({ note: 'a "b"\r\nc' }),
    'note=a "b"\r\nc&token=t-1',
  );
  session.set('token', 't-2');
  assert.equal(await E(derived).postForm({}), 'token=t-2');
});

test('postForm refuses contradictions and malformed fields, naming keys only', async () => {
  const kv = makeKv();
  const ls = makeLiveslots({
    send: () => Promise.reject(Error('this vat imports nothing')),
    kv,
  });
  const { zone } = ls;
  assert.ok(zone);
  const endowment = () => {
    throw Error('no endowments here');
  };
  const powers = harden({
    E,
    Far,
    M,
    zone,
    hashes,
    stdlib: harden({ E, Far, M, hashes }),
    db: noDb,
    endowment,
  });
  /** @type {Remote} */
  const maker = buildWebApp(powers, { egress: makeFetchDevice(formSite) });
  /** @type {MapStore<string, string>} */
  const session = zone.detached().mapStore('session');
  session.init('token', 'secret-1');
  const app = maker
    .makeWebApp('http://site.example/')
    .withFormMap(session.readOnly());
  await assert.rejects(
    E(app).postForm({ token: 'forged' }),
    /^Error: form: contradicts on token$/,
  );
  // the same value twice is no contradiction
  assert.equal(await E(app).postForm({ token: 'secret-1' }), 'token=secret-1');
  await assert.rejects(
    E(app.withHeaders({ 'Content-Type': 'text/plain' })).postForm({}),
    /^Error: headers: contradicts on content-type$/,
  );
  await assert.rejects(E(app).postForm({ 'a"b': 'x' }), /is no field name$/);
  await assert.rejects(
    E(app).postForm({ x: '----toybox-webapp-form-7c1e5d0a9b3f' }),
    /^Error: form: x holds the boundary$/,
  );
  // @ts-expect-error a map may hold what isn't a string; the send refuses it
  session.set('token', 1);
  await assert.rejects(
    E(app).postForm({}),
    /^Error: form: token is not a string$/,
  );
});
