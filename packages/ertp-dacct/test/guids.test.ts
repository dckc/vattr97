import test from 'ava';
import { makeDeterministicGuid, mockMakeGuid, asGuid } from '../src/guids.js';
import type { Guid } from '../src/guids.js';

test('makeDeterministicGuid produces deterministic output', t => {
  const a = makeDeterministicGuid('hello');
  const b = makeDeterministicGuid('hello');
  t.is(a, b);
});

test('makeDeterministicGuid produces different output for different seeds', t => {
  const a = makeDeterministicGuid('hello');
  const b = makeDeterministicGuid('world');
  t.not(a, b);
});

test('makeDeterministicGuid returns 32-char hex string', t => {
  const guid = makeDeterministicGuid('test');
  t.is(guid.length, 32);
  t.regex(guid, /^[0-9a-f]{32}$/);
});

test('mockMakeGuid produces sequential values', t => {
  const makeGuid = mockMakeGuid();
  t.is(makeGuid(), asGuid('00000000000000000000000000000000'));
  t.is(makeGuid(), asGuid('00000000000000000000000000000001'));
  t.is(makeGuid(), asGuid('00000000000000000000000000000002'));
});

test('mockMakeGuid starts from given offset', t => {
  const makeGuid = mockMakeGuid(255n);
  t.is(makeGuid(), asGuid('000000000000000000000000000000ff'));
  t.is(makeGuid(), asGuid('00000000000000000000000000000100'));
});

test('asGuid casts string to Guid type', t => {
  const guid = asGuid('abc');
  t.is(guid, 'abc' as Guid);
});
