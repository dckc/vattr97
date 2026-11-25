/** @file The session keeper (vattr97#67), in one process: a site's door writes the session into its store, as its layout places it, and nothing else. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, Far } from '@endo/far';
import { M } from '@endo/patterns';
import { makeLiveslots } from '../src/vat/liveslots.js';
import {
  buildRootObject as buildKeeper,
  checkSite,
  cookieDomain,
  cookieRefusal,
  entriesFor,
  proposalFragment,
} from '../examples/session-keeper.js';
import { makeMemoryVatstore as makeKv } from './memory-vatstore.js';
import { hashes } from '../src/hashes.js';
import { assert as endoAssert, Fail, q } from '@endo/errors';

/** @import { SqlDatabase } from '../src/types.js' */
/** @import { SessionKeeper } from '../examples/session-keeper.js' */
/** @import { Vatstore } from '../src/vat/types.js' */

const noDb = /** @type {SqlDatabase} */ (/** @type {unknown} */ (harden({})));

const SITE = 'https://bookmarks.example/';
const descriptor = harden({
  site: SITE,
  cookies: ['sid', 'csrf'],
  label: 'Bookmarks',
});
/** swiss numbers drawn so far, across incarnations, as a real entropy device's never repeat */
let drawn = 0;

const layout = harden({ cookie: ['sid', 'csrf'], 'x-csrf': 'csrf' });

/**
 * One incarnation of the keeper vat on `kv`, its store in the same vat.
 *
 * @param {Vatstore} kv
 */
const incarnate = kv => {
  const send = () => Promise.reject(Error('this vat imports nothing'));
  const { zone } = makeLiveslots({ send, kv });
  assert.ok(zone);
  const entropy = Far('entropy', {
    swiss: () => `${(drawn += 1)}`.padStart(32, 'k'),
  });
  const endowment = () => {
    throw Error('no endowments here');
  };
  const powers = harden({
    E,
    Far,
    M,
    zone,
    hashes,
    stdlib: harden({ assert: endoAssert, Fail, q, E, Far, M, hashes }),
    db: noDb,
    endowment,
  });
  const keeper = buildKeeper(powers, { entropy });
  const store = zone.makeOnce('store', () =>
    zone.detached().mapStore('session'),
  );
  /** @type {string[]} */
  const told = [];
  // durable, as a site's hook from another vat would be
  const makeAfter = zone.exoClass('After', undefined, () => ({}), {
    /** @param {string} at */
    sessionSet: at => {
      told.push(at);
      if (at.startsWith('1999')) throw Error('the site said 403');
      return '3 new bookmarks';
    },
  });
  const after = zone.makeOnce('after', () => makeAfter());
  return { keeper, store, after, told };
};

/** @param {string} fragment */
const keyIn = fragment =>
  new URLSearchParams(fragment.slice(1)).get('key') ?? '';

/** @param {SessionKeeper} keeper @param {object} req */
const ask = async (keeper, req) => {
  const res = await E(keeper.door()).serve(JSON.stringify(req));
  const body = res.body ?? '';
  return { status: res.status, body, json: JSON.parse(body) };
};

test('a proposal names the key, the site, and its cookies', () => {
  const fragment = proposalFragment('k1', descriptor);
  const params = new URLSearchParams(fragment.slice(1));
  assert.equal(params.get('key'), 'k1');
  assert.equal(params.get('site'), SITE);
  assert.equal(params.get('label'), 'Bookmarks');
  assert.deepEqual(params.getAll('cookie'), ['sid', 'csrf']);
  assert.equal(params.get('domain'), null);
});

test("a proposal names the cookies' domain, if it's a parent of the site's host", () => {
  const www = { ...descriptor, site: 'https://www.bookmarks.example/' };
  const fragment = proposalFragment('k1', {
    ...www,
    domain: 'bookmarks.example',
  });
  assert.equal(
    new URLSearchParams(fragment.slice(1)).get('domain'),
    'bookmarks.example',
  );
  checkSite({ ...www, domain: 'bookmarks.example' }, layout);
  checkSite({ ...www, domain: 'www.bookmarks.example' }, layout);
  for (const domain of [
    'example',
    'other.example',
    'ookmarks.example',
    'Bookmarks.example',
  ])
    assert.throws(
      () => checkSite({ ...www, domain }, layout),
      /domain:/,
      domain,
    );
  assert.equal(cookieDomain('bookmarks.example', 'bookmarks.example'), true);
  assert.equal(
    cookieDomain('127.0.0.1', '0.0.1'),
    false,
    'an IP address has no parent',
  );
});

test('the layout puts a cookie as itself, or several as a cookie header', () => {
  assert.deepEqual(entriesFor(layout, { sid: 's1', csrf: 'c1' }), [
    ['cookie', 'sid=s1; csrf=c1'],
    ['x-csrf', 'c1'],
  ]);
});

test('the cookies sent must be the ones asked for, named but not quoted when refused', () => {
  const names = ['sid', 'csrf'];
  assert.equal(cookieRefusal(names, { sid: 'a', csrf: 'b' }), undefined);
  assert.equal(cookieRefusal(names, { sid: 'a' }), 'cookies: csrf is missing');
  assert.equal(
    cookieRefusal(names, { sid: 'a', csrf: 'b', other: 'c' }),
    'cookies: other was not asked for',
  );
  assert.equal(
    cookieRefusal(names, { sid: 'a; evil=1', csrf: 'b' }),
    'cookies: sid is malformed',
  );
  assert.match(String(cookieRefusal(names, ['a'])), /record/);
});

test('a site refuses a descriptor whose layout leaves out or adds a cookie', () => {
  const { keeper, store } = incarnate(makeKv());
  assert.throws(
    () => keeper.site('s', descriptor, { store, layout: { cookie: ['sid'] } }),
    /^Error: layout: puts csrf nowhere$/,
  );
  assert.throws(
    () =>
      keeper.site('s', descriptor, {
        store,
        layout: { cookie: ['sid', 'csrf', 'x'] },
      }),
    /^Error: layout: x is not among the cookies$/,
  );
  for (const site of [
    'http://bookmarks.example/',
    'ftp://x/',
    'https://u:p@x/',
  ])
    assert.throws(
      () => keeper.site('s', { ...descriptor, site }, { store, layout }),
      /^Error: site:/,
    );
  keeper.site(
    's',
    { ...descriptor, site: 'http://127.0.0.1:9/' },
    { store, layout },
  );
});

test('the door writes the session, tells the app, and answers without the values', async () => {
  const { keeper, store, after, told } = incarnate(makeKv());
  const site = keeper.site('bookmarks', descriptor, { store, layout, after });
  const key = keyIn(await E(site).fragment());
  assert.equal(keyIn(await E(site).fragment()), key, 'one door at a time');

  const sent = await ask(keeper, {
    key,
    op: 'set',
    cookies: { sid: 'SECRET-s', csrf: 'SECRET-c' },
    at: '2026-11-17T15:00:00.000Z',
  });
  assert.deepEqual(sent.json, {
    ok: true,
    summary: 'Bookmarks session stored; 3 new bookmarks',
  });
  assert.doesNotMatch(sent.body, /SECRET/);
  assert.deepEqual(store.entries(), [
    ['cookie', 'sid=SECRET-s; csrf=SECRET-c'],
    ['x-csrf', 'SECRET-c'],
  ]);
  assert.deepEqual(told, ['2026-11-17T15:00:00.000Z']);
  assert.deepEqual(site.status(), {
    ...descriptor,
    open: true,
    at: '2026-11-17T15:00:00.000Z',
  });

  // the app's follow-up may fail; the session is stored anyway
  const stale = await ask(keeper, {
    key,
    cookies: { sid: 's2', csrf: 'c2' },
    at: '1999-01-01T00:00:00Z',
  });
  assert.equal(stale.status, 502);
  assert.deepEqual(stale.json, {
    ok: false,
    stored: true,
    error: 'the site said 403',
  });
  assert.equal(store.get('x-csrf'), 'c2');
});

test('a wrong key, a bad body, or a bad op gets nothing written', async () => {
  const { keeper, store } = incarnate(makeKv());
  const site = keeper.site('bookmarks', descriptor, { store, layout });
  const key = keyIn(await E(site).fragment());
  const cookies = { sid: 's', csrf: 'c' };
  const at = '2026-11-17T15:00:00Z';
  for (const k of [undefined, '', 'guess', 3])
    assert.equal((await ask(keeper, { key: k, cookies, at })).status, 403);
  assert.equal((await E(keeper.door()).serve('{')).status, 400);
  assert.equal((await ask(keeper, { key, cookies, at: 'now' })).status, 400);
  assert.equal(
    (await ask(keeper, { key, cookies: { sid: 's' }, at })).status,
    400,
  );
  assert.equal((await ask(keeper, { key, op: 'get' })).status, 400);
  assert.equal(store.getSize(), 0);
  assert.deepEqual((await ask(keeper, { key, cookies, at })).json, {
    ok: true,
    summary: 'Bookmarks session stored',
  });
});

test('revoking, at either end, closes the door and clears the session', async () => {
  const { keeper, store } = incarnate(makeKv());
  const site = keeper.site('bookmarks', descriptor, { store, layout });
  const cookies = { sid: 's', csrf: 'c' };
  const at = '2026-11-17T15:00:00Z';

  const first = keyIn(await E(site).fragment());
  await ask(keeper, { key: first, cookies, at });
  await E(site).revoke();
  assert.equal(store.getSize(), 0);
  assert.equal(site.status().open, false);
  assert.equal((await ask(keeper, { key: first, cookies, at })).status, 403);

  const second = keyIn(await E(site).fragment());
  assert.notEqual(second, first);
  await ask(keeper, { key: second, cookies, at });
  assert.deepEqual((await ask(keeper, { key: second, op: 'revoke' })).json, {
    ok: true,
    summary: 'Bookmarks: revoked',
  });
  assert.equal(store.getSize(), 0);
  assert.equal((await ask(keeper, { key: second, cookies, at })).status, 403);
});

test('doors outlive a restart; a changed descriptor closes the door for review', async () => {
  const kv = makeKv();
  const one = incarnate(kv);
  const key = keyIn(
    await E(
      one.keeper.site('bookmarks', descriptor, { store: one.store, layout }),
    ).fragment(),
  );

  const two = incarnate(kv);
  const site = two.keeper.site('bookmarks', descriptor, {
    store: two.store,
    layout,
  });
  assert.equal(keyIn(await E(site).fragment()), key);
  const cookies = { sid: 's', csrf: 'c' };
  const at = '2026-11-17T15:00:00Z';
  assert.equal((await ask(two.keeper, { key, cookies, at })).status, 200);

  const three = incarnate(kv);
  const more = { ...descriptor, cookies: ['sid'] };
  const changed = three.keeper.site('bookmarks', more, {
    store: three.store,
    layout: { cookie: ['sid'] },
  });
  assert.equal(changed.status().open, false);
  assert.equal(
    (await ask(three.keeper, { key, cookies: { sid: 's' }, at })).status,
    403,
  );
  assert.notEqual(keyIn(await E(changed).fragment()), key);
});
