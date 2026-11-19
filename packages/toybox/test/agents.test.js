/** @file The wallet's agents, in one process: hosts meet by invitation and send each other references. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Far } from '@endo/far';
import { M } from '@endo/patterns';
import { makeLiveslots } from '../src/vat/liveslots.js';
import { prepareAgentsKit } from '../examples/wallet/gateway/agents.exo.js';
import { makeMemoryVatstore } from './memory-vatstore.js';

/** @import { Remote, Zone } from '../src/types.js' */

/** A durable zone of its own, over an in-memory vatstore. */
const makeZone = () => {
  const send = () => Promise.reject(Error('these agents import nothing'));
  const { zone } = makeLiveslots({ send, kv: makeMemoryVatstore() });
  assert.ok(zone);
  return zone;
};

/**
 * An agents kit in `zone`.
 *
 * @param {Zone} zone
 * @param {{ starters?: Record<string, Remote> }} [opts]
 */
const makeAgentsKit = (zone, { starters = {} } = {}) =>
  prepareAgentsKit(zone, { Far, M, starters });

test('two hosts meet by invitation, once, and send each other references by the names they know each other by', async () => {
  const zone = makeZone();
  const counters = zone.exo('Counters', undefined, {});
  const kit = makeAgentsKit(zone, { starters: { counters } });
  const { host: a } = kit.newHost('alice');
  assert.deepEqual(a.names().nameHub.keys(), ['counters']);

  const invitation = a.invite('bob');
  const { host: b, inviter } = await invitation.accept();
  assert.equal(inviter, 'alice');
  await assert.rejects(invitation.accept(), /no such invitation/);
  assert.equal(kit.agentOf(b)?.kind, 'host');
  assert.deepEqual([...b.names().nameHub.keys()].sort(), ['alice', 'counters']);
  assert.equal(a.names().nameHub.has('bob'), true);

  /** @type {[string, string[], string[], string[], RegExp][]} a send, and its refusal */
  const malformed = [
    ['alice', [], ['c'], ['counters'], /a string before each name/],
    ['alice', ['x'], ['a', 'b'], ['counters'], /an edge name for each/],
    ['counters', ['x'], [], [], /"counters" names no correspondent/],
  ];
  for (const [to, strings, edgeNames, petNames, refusal] of malformed)
    await assert.rejects(b.send(to, strings, edgeNames, petNames), refusal);

  // she can wait for mail before it comes
  const mail = a.followMessages();
  const waited = mail.next();
  await b.send('alice', ['my counters'], ['c'], ['counters']);
  const first = {
    number: 1,
    from: 'bob',
    type: 'package',
    strings: ['my counters'],
    names: ['c'],
  };
  assert.deepEqual(await waited, { value: first, done: false });
  // or after: the mail that's there comes first
  assert.deepEqual(await a.followMessages().next(), {
    value: first,
    done: false,
  });
  assert.deepEqual(a.listMessages(), [first]);
  await b.send('alice', ['again'], [], []);
  assert.deepEqual(
    a.listMessages().map(m => m.number),
    [1, 2],
    'in the order they came',
  );
  a.dismiss(2);
  assert.throws(() => a.adopt(1, 'x', 'x'), /message 1 has no "x"/);
  a.adopt(1, 'c', 'bobs-counters');
  assert.equal(await a.names().nameHub.lookup('bobs-counters'), counters);
  a.dismiss(1);
  assert.deepEqual(a.listMessages(), []);
});
