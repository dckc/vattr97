/** @file The wallet's agents, in one process: hosts meet by invitation and send each other references; a host's guest proposes a definition, which the host endows. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, Far } from '@endo/far';
import { M } from '@endo/patterns';
import { makeLiveslots } from '../src/vat/liveslots.js';
import { prepareAgentsKit } from '../examples/wallet/gateway/agents.exo.js';
import { makeMemoryVatstore } from './memory-vatstore.js';

/**
 * @import { Remote, Zone } from '../src/types.js';
 * @import { Definer } from '../examples/wallet/gateway/agents.exo.js';
 */

/** A durable zone of its own, over an in-memory vatstore. */
const makeZone = () => {
  const send = () => Promise.reject(Error('these agents import nothing'));
  const { zone } = makeLiveslots({ send, kv: makeMemoryVatstore() });
  assert.ok(zone);
  return zone;
};

/**
 * An agents kit in `zone`, with `definer` to run what a host endows.
 *
 * @param {Zone} zone
 * @param {{ starters?: Record<string, Remote>, definer?: Definer }} [opts]
 */
const makeAgentsKit = (zone, { starters = {}, definer } = {}) =>
  prepareAgentsKit(zone, {
    E,
    Far,
    M,
    starters,
    definer: () => {
      if (!definer) throw Error('no definer here');
      return definer;
    },
  });

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

test("a host's guest knows only its host, proposes a definition, and gets nothing back but what the host sends", async () => {
  const zone = makeZone();
  const bank = zone.exo('Bank', undefined, {});
  /** @type {{ modules: Record<string, string>, params: Record<string, Remote> }[]} */
  const ran = [];
  const definer = Far('definer', {
    /** @param {Record<string, string>} modules @param {Record<string, Remote>} params */
    run: async (modules, params) => {
      ran.push({ modules, params });
      return zone.exo('Reader', undefined, {});
    },
  });
  const kit = makeAgentsKit(zone, { definer });
  const { host } = kit.newHost('alice');
  host.names().nameAdmin.update('bank', bank);

  const guest = await host.provideGuest('hal');
  assert.equal(await host.provideGuest('hal'), guest, 'the same one');
  await assert.rejects(host.provideGuest('bank'), /"bank" names no guest/);
  assert.equal(kit.agentOf(guest)?.kind, 'guest');
  assert.deepEqual(guest.names().nameHub.keys(), ['host']);

  const modules = { 'main.js': 'export const buildRootObject = () => ({});' };
  assert.throws(
    () => guest.define(modules, { '1st': { label: 'x' } }),
    /not a slot name: "1st"/,
  );
  guest.define(modules, { bank: { label: 'the bank, as you' } });
  const [proposal] = host.listMessages();
  assert.deepEqual(proposal, {
    number: 1,
    from: 'hal',
    type: 'definition',
    modules,
    slots: { bank: { label: 'the bank, as you' } },
  });

  /** @type {[Record<string, string>, string, RegExp][]} bindings, a name, and the refusal */
  const careless = [
    [{}, 'reader', /nothing for bank/],
    [{ bank: 'bank', mint: 'bank' }, 'reader', /no slot mint/],
    [{ bank: 'bank' }, '', /a name to save it as/],
  ];
  for (const [bindings, saveAs, refusal] of careless)
    await assert.rejects(host.endow(1, bindings, saveAs), refusal);
  assert.equal(ran.length, 0, 'no vat of a careless endowment');

  await host.endow(1, { bank: 'bank' }, 'reader');
  assert.deepEqual(ran, [{ modules, params: { bank } }]);
  assert.ok(host.names().nameHub.has('reader'));
  assert.deepEqual(guest.names().nameHub.keys(), ['host']);
  assert.equal(kit.agentOf(bank), undefined);
});
