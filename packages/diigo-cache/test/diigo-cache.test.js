/**
 * @file diigo-cache's vats in one process, wired as boot.js wires them,
 * over a fake diigo: the extension's request sets the session through
 * the keeper's door, the cache reads through its WebApp, and the public
 * page shows shared bookmarks only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { E, Far } from '@endo/far';
import { M } from '@endo/patterns';
import { makeLiveslots } from '../../toybox/src/vat/liveslots.js';
import { makeFetchDevice } from '../../toybox/src/devices/fetch.js';
import { makeMemoryVatstore } from '../../toybox/test/memory-vatstore.js';
import { buildRootObject as buildWebApp } from '../../toybox/examples/webapp.js';
import { buildRootObject as buildKeeper } from '../../toybox/examples/session-keeper.js';
import { buildRootObject as buildCache } from '../src/cache/cache.js';
import { buildRootObject as buildGateway } from '../src/gateway/gateway.js';
import { DIIGO, HEADERS, ITEMS } from '../src/boot.js';
import { parseQuery } from '../src/cache/query.js';

/**
 * @import { Handler, MapStore, SqlDatabase } from '../../toybox/src/types.js';
 * @import { WebApp } from '../../toybox/examples/webapp.js';
 * @import { Item } from '../src/cache/items.js';
 */

const GOOD = {
  diigoandlogincookie: 'GOOD-login',
  _smasher_session: 'GOOD-sess',
};

/** 2026-11-01T00:00:00Z, in epoch seconds, as diigo dates items */
const NOV1 = Date.UTC(2026, 10, 1) / 1000;
const DAY = 24 * 60 * 60;

/**
 * A fake diigo: `count` bookmarks, newest updated first, every third one
 * private; it answers only a request with the good session cookie.
 *
 * @param {number} count
 */
const makeDiigo = count => {
  /** @type {Record<string, unknown>[]} */
  const items = Array.from({ length: count }, (_, i) => ({
    link_id: 1000 + i,
    url: `https://example.org/${i}`,
    title: i % 3 === 2 ? `PRIVATE ${i}` : `shared ${i}`,
    description: i === 0 ? 'the newest' : '',
    tags: i % 2 ? 'odd,weekly' : 'even',
    created_at: NOV1 - i * DAY,
    updated_at: NOV1 - i * DAY,
    u_name: 'dckc-test',
    private: i % 3 === 2,
    comments: ['dropped'],
  }));
  /** @type {string[]} */
  const seen = [];
  /** @param {Request} request */
  const site = async request => {
    const url = new URL(request.url);
    if (url.origin + url.pathname !== ITEMS)
      return new Response('egress refused', { status: 403 });
    seen.push(url.searchParams.get('page_num') ?? '');
    const want = `diigoandlogincookie=${GOOD.diigoandlogincookie}; _smasher_session=${GOOD._smasher_session}`;
    if (
      request.headers.get('cookie') !== want ||
      request.headers.get('x-requested-with') !== 'XMLHttpRequest'
    )
      return new Response('<html>please log in</html>', { status: 401 });
    const size = Number(url.searchParams.get('count'));
    const n = Number(url.searchParams.get('page_num'));
    return Response.json({
      total: items.length,
      items: items.slice(n * size, (n + 1) * size),
    });
  };
  return { items, site, seen };
};

/** The vats, as boot.js wires them, in one liveslots; the ingress keeps the handler it's given. */
const setup = (count = 250) => {
  const diigo = makeDiigo(count);
  const send = () => Promise.reject(Error('these vats import nothing'));
  const { zone } = makeLiveslots({ send, kv: makeMemoryVatstore() });
  assert.ok(zone);
  const endowment = () => {
    throw Error('no endowments here');
  };
  const powers = harden({
    E,
    Far,
    M,
    zone,
    db: /** @type {SqlDatabase} */ (/** @type {unknown} */ (harden({}))),
    endowment,
  });
  let n = 0;
  const entropy = Far('entropy', {
    swiss: () => `${(n += 1)}`.padStart(32, 'e'),
  });
  const webApps = buildWebApp(powers, {
    egress: makeFetchDevice(diigo.site),
  });
  /** @type {MapStore<string, string>} */
  const store = zone.detached().mapStore('diigo-session');
  // in one process, a WebApp is a local object, not only a reference
  const base = /** @type {WebApp} */ (webApps.makeWebApp(ITEMS, HEADERS));
  const source = base.withHeaderMap(store.readOnly());
  const cache = buildCache(powers, { source });
  const keeper = buildKeeper(powers, { entropy });
  const site = keeper.site('diigo', DIIGO, {
    store,
    layout: { cookie: [...DIIGO.cookies] },
    after: cache.onSession(),
  });
  /** @type {(h: Handler) => void} */
  let serve = () => {};
  /** @type {Promise<Handler>} */
  const served = new Promise(resolve => (serve = resolve));
  const ingress = Far('ingress', {
    serve: (/** @type {Handler} */ h) => serve(h),
  });
  const gateway = buildGateway(powers, {
    ingress,
    entropy,
    cache,
    viewer: cache.viewer(),
    site,
    door: keeper.door(),
  });
  /** @param {string} method @param {string} path @param {object} [body] @param {Record<string, string>} [labels] */
  const ask = async (method, path, body, labels = {}) => {
    const res = await E(await served).handle({
      method,
      path,
      labels,
      body: body ? JSON.stringify(body) : '',
    });
    const headers = res.headers ?? {};
    const text = res.body ?? '';
    const isJson = headers['content-type'] === 'application/json';
    return {
      status: res.status,
      headers,
      body: text,
      json: isJson ? JSON.parse(text) : undefined,
    };
  };
  return { diigo, store, gateway, ask };
};

/** @param {string} fragment @param {string} name */
const param = (fragment, name) =>
  new URLSearchParams(fragment.slice(1)).get(name) ?? '';

/** The owner's key, and a proposal fragment from the owner page. @param {ReturnType<typeof setup>} s */
const propose = async ({ gateway, ask }) => {
  const owner = param(await E(gateway).provideOwnerLink(), 'owner');
  const { json } = await ask('POST', '/api/owner', {
    key: owner,
    op: 'proposal',
  });
  return { owner, fragment: json.fragment };
};

const AT = '2026-11-17T15:00:00.000Z';

test('the proposal names diigo, its cookies, and a key other than the owner key', async () => {
  const s = setup();
  const { owner, fragment } = await propose(s);
  assert.equal(param(fragment, 'site'), 'https://www.diigo.com/');
  assert.deepEqual(
    new URLSearchParams(fragment.slice(1)).getAll('cookie'),
    DIIGO.cookies,
  );
  assert.notEqual(param(fragment, 'key'), owner);
});

test("the extension's request stores the cookie, refreshes, and fills; it hears counts only", async () => {
  const s = setup();
  const { fragment } = await propose(s);
  const sent = await s.ask('POST', '/api/session', {
    key: param(fragment, 'key'),
    op: 'set',
    cookies: GOOD,
    at: AT,
  });
  assert.equal(sent.status, 200);
  assert.equal(
    sent.json.summary,
    'diigo session stored; refreshed 3 pages: 250 new, 0 changed; filled through page 3: 0 new, 0 changed',
  );
  assert.doesNotMatch(sent.body, /GOOD|example\.org|shared \d/);
  assert.equal(
    s.store.get('cookie'),
    'diigoandlogincookie=GOOD-login; _smasher_session=GOOD-sess',
  );

  const again = await s.ask('POST', '/api/session', {
    key: param(fragment, 'key'),
    cookies: GOOD,
    at: AT,
  });
  assert.equal(
    again.json.summary,
    'diigo session stored; refreshed 1 page: 0 new, 0 changed',
    'a refresh stops at what it has',
  );
});

test('a session diigo refuses is stored anyway, and the refusal says why', async () => {
  const s = setup();
  const { fragment } = await propose(s);
  const bad = { diigoandlogincookie: 'stale', _smasher_session: 'stale' };
  const sent = await s.ask('POST', '/api/session', {
    key: param(fragment, 'key'),
    cookies: bad,
    at: AT,
  });
  assert.equal(sent.status, 502);
  assert.equal(sent.json.stored, true);
  assert.match(
    sent.json.error,
    /^401 on https:\/\/www\.diigo\.com\/interact_api\/load_user_items: <html>please log in/,
  );
  assert.doesNotMatch(sent.body, /stale/);
});

test('the public page shows shared bookmarks only, as an h-feed, filtered', async () => {
  const s = setup();
  assert.equal(
    (await s.ask('GET', '/public/dckc-test')).status,
    404,
    'nothing kept yet',
  );
  const { owner, fragment } = await propose(s);
  await s.ask('POST', '/api/session', {
    key: param(fragment, 'key'),
    cookies: GOOD,
    at: AT,
  });

  const page = await s.ask('GET', '/public/dckc-test');
  assert.equal(page.status, 200);
  assert.match(page.body, /<ol class="h-feed">/);
  assert.match(
    page.body,
    /<li class="h-entry"><time class="dt-updated" datetime="2026-11-01T00:00:00.000Z">/,
  );
  assert.match(page.body, /167 bookmarks, page 1 of 4/);
  assert.doesNotMatch(page.body, /PRIVATE/);
  assert.equal((await s.ask('GET', '/public/someone-else')).status, 404);

  const all = await s.ask('GET', '/public/dckc-test', undefined, {
    format: 'json',
    page: '4',
  });
  assert.equal(all.json.items.length, 17);
  assert.equal(all.json.complete, true);
  assert.ok(
    all.json.items.every(
      (/** @type {Item} */ it) => !it.private && !('comments' in it),
    ),
  );

  // the last 20 days, counted back from the last fetch (Nov 17, 15:00): Oct 28, 15:00 on
  const recent = await s.ask('GET', '/public/dckc-test', undefined, {
    format: 'json',
    days: '20',
  });
  assert.deepEqual(
    recent.json.items.map((/** @type {Item} */ it) => it.title),
    ['shared 0', 'shared 1', 'shared 3'],
  );
  const tagged = await s.ask('GET', '/public/dckc-test', undefined, {
    format: 'json',
    q: '#weekly',
    in: '2026-10',
  });
  assert.ok(
    tagged.json.items.every((/** @type {Item} */ it) =>
      String(it.tags).split(',').includes('weekly'),
    ),
  );
  const refused = await s.ask('GET', '/public/dckc-test', undefined, {
    days: 'lots',
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body, /days: expected a whole number/);

  // the owner sees the private count; the status names no bookmark
  const { json: status } = await s.ask('POST', '/api/owner', {
    key: owner,
    op: 'status',
  });
  assert.deepEqual(
    {
      shared: status.cache.shared,
      private: status.cache.private,
      user: status.cache.user,
      open: status.session.open,
    },
    { shared: 167, private: 83, user: 'dckc-test', open: true },
  );
});

test('a bookmark made private leaves the shared store', async () => {
  const s = setup(3);
  const { owner, fragment } = await propose(s);
  await s.ask('POST', '/api/session', {
    key: param(fragment, 'key'),
    cookies: GOOD,
    at: AT,
  });
  s.diigo.items[0] = {
    ...s.diigo.items[0],
    private: true,
    updated_at: NOV1 + DAY,
  };
  s.diigo.items.unshift(s.diigo.items.splice(0, 1)[0]);
  const { json } = await s.ask('POST', '/api/owner', {
    key: owner,
    op: 'refresh',
    at: AT,
  });
  assert.deepEqual(
    json.refreshed,
    { pages: 1, added: 1, changed: 0 },
    'new to the private store',
  );
  const page = await s.ask('GET', '/public/dckc-test', undefined, {
    format: 'json',
  });
  assert.deepEqual(
    page.json.items.map((/** @type {Item} */ it) => it.title),
    ['shared 1'],
  );
});

test('the owner key opens the owner routes only; revoking closes the door', async () => {
  const s = setup();
  const { owner, fragment } = await propose(s);
  const key = param(fragment, 'key');
  for (const k of [undefined, 'guess', key])
    assert.equal(
      (await s.ask('POST', '/api/owner', { key: k, op: 'status' })).status,
      403,
    );
  assert.equal(
    (await s.ask('POST', '/api/session', { key: owner, cookies: GOOD, at: AT }))
      .status,
    403,
  );
  assert.equal(
    (await s.ask('POST', '/api/owner', { key: owner, op: 'nope' })).status,
    400,
  );

  await s.ask('POST', '/api/session', { key, cookies: GOOD, at: AT });
  assert.equal(
    (await s.ask('POST', '/api/owner', { key: owner, op: 'revoke' })).json.ok,
    true,
  );
  assert.equal(s.store.has('cookie'), false);
  assert.equal(
    (await s.ask('POST', '/api/session', { key, cookies: GOOD, at: AT }))
      .status,
    403,
  );
});

test('the pages are static shells that keep to their own origin', async () => {
  const s = setup();
  const page = await s.ask('GET', '/');
  assert.match(page.body, /<script src="\/page\.js"><\/script>/);
  assert.doesNotMatch(page.body, /<script>|https?:\/\//);
  const script = await s.ask('GET', '/page.js');
  assert.match(script.headers['content-type'], /^text\/javascript/);
  assert.equal((await s.ask('GET', '/elsewhere')).status, 404);
  // a script the browser can parse, with the hashicon embedded
  assert.doesNotThrow(() => new Script(script.body));
  assert.match(script.body, /const hashicon = \(doc, bytes\) =>/);
});

test("the owner page's hashicon is the extension's, so the two pictures match", async () => {
  const [ours, theirs] = await Promise.all(
    ['../src/gateway/hashicon.js', '../../session-ext/hashicon.js'].map(f =>
      readFile(new URL(f, import.meta.url), 'utf8'),
    ),
  );
  assert.equal(ours, theirs, 'copy session-ext/hashicon.js to src/gateway/');
});

test('filters, as the public page parses them', () => {
  const now = new Date('2026-11-17T00:00:00Z');
  assert.deepEqual(parseQuery({ in: '2026-W41' }, now), {
    by: 'updated',
    words: [],
    tags: [],
    after: new Date('2026-10-05T00:00:00Z'),
    before: new Date('2026-10-12T00:00:00Z'),
  });
  assert.deepEqual(parseQuery({ days: '7', after: '2026-01-01' }, now), {
    error: 'days and after both set where the window starts',
  });
});
