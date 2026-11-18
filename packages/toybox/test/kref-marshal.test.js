/** @file The kernel's marshal never tells a vat a kref: a stand-in keeps its sender's interface name, or its kind's. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKrefMarshal } from '../src/kernel/kref-marshal.js';

/** @import { Kref } from '../src/kernel/types.js' */

const kinds = /** @type {Record<Kref, string>} */ ({ ko35: 'jwtSigners' });
const nameOf = (/** @type {Kref} */ kref) => kinds[kref] ?? 'remote';

test("a reference passed through the kernel keeps its sender's interface name, and no kref", () => {
  const krefs = makeKrefMarshal(nameOf);
  // as a vat sent it: its counters maker, in a createVat's params
  const params = krefs.fromCapData({
    body: '#{"counters":"$0.Alleged: Counters"}',
    slots: ['ko16'],
  });
  assert.equal(String(params.counters), '[object Alleged: Counters]');
  const out = krefs.toCapData(params);
  assert.deepEqual(out.slots, ['ko16']);
  assert.doesNotMatch(out.body, /ko16/);
  assert.match(out.body, /Alleged: Counters/);
});

test("a kernel object's stand-in is named for its kind; one with no name known, 'remote'", () => {
  const { standIn, toCapData, krefOf } = makeKrefMarshal(nameOf);
  const signers = standIn('ko35');
  assert.equal(krefOf(signers), 'ko35');
  assert.doesNotMatch(toCapData(harden([signers, standIn('ko7')])).body, /ko\d/);
  assert.equal(String(signers), '[object Alleged: jwtSigners]');
  assert.equal(String(standIn('ko7')), '[object Alleged: remote]');
});

test('a name the marshal once gave, the kref itself, read back from stored params, is no name', () => {
  const krefs = makeKrefMarshal(nameOf);
  const stored = harden({
    body: '#{"jwtSigners":"$0.Alleged: kref ko35"}',
    slots: /** @type {Kref[]} */ (['ko35']),
  });
  const out = krefs.toCapData(krefs.fromCapData(stored));
  assert.equal(out.body, '#{"jwtSigners":"$0.Alleged: jwtSigners"}');
});
