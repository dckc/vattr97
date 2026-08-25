import test from 'ava';
import {
  Nat,
  freezeProps,
  defaultZone,
  getInterfaceOf,
} from '../src/jessie-tools.js';

test('Nat accepts valid bigint', t => {
  t.is(Nat(42n), 42n);
  t.is(Nat(0n), 0n);
});

test('Nat rejects negative bigint', t => {
  t.throws(() => Nat(-1n), { message: 'amount must be non-negative' });
});

test('Nat rejects non-bigint', t => {
  t.throws(() => Nat(42 as unknown as bigint), {
    message: 'amount must be bigint',
  });
  t.throws(() => Nat('42' as unknown as bigint), {
    message: 'amount must be bigint',
  });
});

test('freezeProps freezes methods and object', t => {
  const obj = {
    foo: () => 'bar',
    baz: 42,
  };
  const frozen = freezeProps(obj);
  t.true(Object.isFrozen(frozen));
  t.true(Object.isFrozen(frozen.foo));
});

test('defaultZone.exo returns frozen object', t => {
  const result = defaultZone.exo('TestInterface', {
    greet: () => 'hello',
  });
  t.true(Object.isFrozen(result));
  t.true(Object.isFrozen(result.greet));
  t.is(result.greet(), 'hello');
});

test('defaultZone.exo sets correct toStringTag', t => {
  const result = defaultZone.exo('MyInterface', {});
  t.is(getInterfaceOf(result), 'MyInterface');
});

test('getInterfaceOf returns undefined for non-objects', t => {
  t.is(getInterfaceOf(null), undefined);
  t.is(getInterfaceOf(42), undefined);
  t.is(getInterfaceOf('string'), undefined);
});

test('getInterfaceOf returns undefined for objects without tag', t => {
  t.is(getInterfaceOf({}), undefined);
});
