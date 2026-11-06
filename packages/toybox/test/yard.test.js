/** @file The neighbor's yard, in one process, with a fake mower and tenant: its behavior in a heap zone, and its durability under liveslots over an in-memory vatstore. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E } from '@endo/far';
import { makeHeapZone } from '../src/vat/heap-zone.js';
import { makeLiveslots } from '../src/vat/liveslots.js';
import { MAX_PUSHES, provideYard } from '../examples/neighbor/boot/yard.exo.js';
import { makeMemoryVatstore as makeKv } from './memory-vatstore.js';

/** @import { HttpRequest, MapStore, Remote, Zone } from '../src/types.js' */
/** @import { Vatstore } from '../src/vat/types.js' */

/**
 * The yard in `zone`, beside a mower that has cut (4, 4) and (4, 3), and a
 * tenant that answers what it was lent.
 *
 * @param {Zone} zone
 */
const provideTestYard = zone => {
  const mower = zone.exo('FakeMower', undefined, {
    getCut: () => ['(4, 4)', '(4, 3)'],
  });
  const governed = zone.exo('FakeGoverned', undefined, {});
  const tenant = zone.exo('FakeTenant', undefined, {
    /** @param {Remote} lent @param {number} pushes */
    run: (lent, pushes) => [
      lent === governed ? 'lent the governed mower' : 'lent something else',
      `${pushes} pushes`,
      '<b>fence</b>',
    ],
  });
  /** @type {MapStore<string, Remote>} */
  const lease = zone.mapStore('lease');
  if (!lease.has('mower')) {
    lease.init('mower', mower);
    lease.init('governed', governed);
    lease.init('tenant', tenant);
  }
  return provideYard(zone, { E, lease, fence: 3 });
};

/**
 * One incarnation of a vat holding the yard on `kv`.
 *
 * @param {Vatstore} kv
 */
const incarnate = kv => {
  const send = () => Promise.reject(Error('this vat imports nothing'));
  const { zone } = makeLiveslots({ send, kv });
  assert.ok(zone);
  return provideTestYard(zone);
};

/** @param {Partial<HttpRequest>} request */
const req = request => ({
  method: 'GET',
  path: '/',
  labels: {},
  body: '',
  ...request,
});

test('the yard shows what the mower cut, and lends the tenant the governed mower', async () => {
  const yard = provideTestYard(makeHeapZone());
  const before = await E(yard).handle(req({}));
  assert.equal(before.status, 200);
  assert.match(before.body, /2 of 64 cells cut/);
  // the mower where it last cut, (4, 3); what it cut before, green
  assert.match(before.body, /\n⬜⬜⬜⬜🚜⬜⬜⬜\n⬜⬜⬜⬜🟩⬜⬜⬜\n/);
  assert.match(before.body, /the fence is 3 pushes/);
  assert.doesNotMatch(before.body, /last run/);

  const run = await E(yard).handle(
    req({ method: 'POST', path: '/run', body: 'pushes=5' }),
  );
  assert.deepEqual(run, { status: 303, headers: { location: '/' } });
  const after = (await E(yard).handle(req({}))).body;
  assert.match(
    after,
    /<li>lent the governed mower<\/li><li>5 pushes<\/li><li>&lt;b&gt;fence&lt;\/b&gt;<\/li>/,
  );
});

test('the yard refuses pushes it does not allow, and paths it does not serve', async () => {
  const yard = provideTestYard(makeHeapZone());
  for (const pushes of ['0', '1.5', 'many', String(MAX_PUSHES + 1)]) {
    const resp = await E(yard).handle(
      req({ method: 'POST', path: '/run', body: `pushes=${pushes}` }),
    );
    assert.equal(resp.status, 400, pushes);
  }
  assert.equal((await E(yard).handle(req({ path: '/elsewhere' }))).status, 404);
});

test('the yard, and its last run, outlast an incarnation', async () => {
  const kv = makeKv();
  const first = incarnate(kv);
  await E(first).handle(
    req({ method: 'POST', path: '/run', body: 'pushes=2' }),
  );
  const second = incarnate(kv);
  assert.match((await E(second).handle(req({}))).body, /<li>2 pushes<\/li>/);
});
