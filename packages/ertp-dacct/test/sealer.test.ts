import test from 'ava';
import { makeSealerUnsealerPair } from '../src/sealer.js';

test('seal and unseal round-trips', t => {
  const { sealer, unsealer } = makeSealerUnsealerPair();
  const obj = { secret: 'data' };
  const sealed = sealer.seal(obj);
  const unsealed = unsealer.unseal(sealed);
  t.is(unsealed, obj);
});

test('different pairs reject each other', t => {
  const pair1 = makeSealerUnsealerPair();
  const pair2 = makeSealerUnsealerPair();
  const obj = { value: 42 };
  const sealed = pair1.sealer.seal(obj);
  t.throws(() => pair2.unsealer.unseal(sealed), {
    message: "That's not my sealed object!",
  });
});

test('sealing same object returns same token', t => {
  const { sealer } = makeSealerUnsealerPair();
  const obj = { x: 1 };
  const a = sealer.seal(obj);
  const b = sealer.seal(obj);
  t.is(a, b);
});

test('sealed object is frozen', t => {
  const { sealer } = makeSealerUnsealerPair();
  const sealed = sealer.seal({});
  t.true(Object.isFrozen(sealed));
});

test('sealer facets and tokens use the supplied zone', t => {
  const interfaces: string[] = [];
  const zone = {
    exo: <T extends Record<PropertyKey, unknown>>(
      interfaceName: string,
      methods: T,
    ) => {
      interfaces.push(interfaceName);
      return Object.freeze(methods);
    },
  };
  const { sealer } = makeSealerUnsealerPair(zone);
  sealer.seal({});
  t.deepEqual(interfaces, ['Sealer', 'Unsealer', 'Sealed']);
});
