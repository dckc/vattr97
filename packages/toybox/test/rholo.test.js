/** @file rholo deploy signers: deploys for one shard, under a phlo limit, signed with a key read from someone's map store. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { secp256k1 } from '@noble/curves/secp256k1';
import { blake2b } from '@noble/hashes/blake2b';
import { hexToBytes } from '@noble/hashes/utils';
import { Far } from '@endo/far';
import {
  TABLES,
  encodeDeployData,
  makeRholoSigners,
} from '../src/devices/rholo.js';
import { makeORM } from '../src/orm.js';
import { makeSql } from './memory-sql.js';

/** @import { Kref } from '../src/kernel/types.js' */
/** @import { DeployData, SignedDeploy, Tables } from '../src/devices/rholo.js' */
/** @import { ORM } from '../src/orm.js' */

const KEY1 = '11'.repeat(32);
const KEY2 = '22'.repeat(32);

/** A signer device over an in-memory table, and a key map, kept by the test, that `send` reads. */
const setup = () => {
  const sql = makeSql(new DatabaseSync(':memory:'));
  for (const ddl of Object.values(TABLES)) sql.exec(ddl);
  let n = 0;
  /** @type {Map<string, unknown>} */
  const keyMap = new Map();
  const keyMapRef = Far('readOnly', {});
  /** @type {WeakMap<object, Kref>} */
  const krefs = new WeakMap();
  krefs.set(keyMapRef, 'ko1000');
  const device = makeRholoSigners(
    harden({
      db: /** @type {ORM<Tables>} */ (makeORM(sql, Object.keys(TABLES))),
      next: () => (n += 1),
      kernelObject: key =>
        /** @type {Kref} the test's krefs are the keys */ (
          /** @type {unknown} */ (key)
        ),
      standIn: kref => {
        const obj = Far('standIn', {});
        krefs.set(obj, kref);
        return obj;
      },
      krefOf: obj =>
        typeof obj === 'object' && obj ? krefs.get(obj) : undefined,
      keyOf: () => undefined,
    }),
    {
      send: async (kref, method) => {
        assert.equal(`${kref}.${method}`, 'ko1000.entries');
        return [...keyMap.entries()];
      },
    },
  );
  const { rholoSigners, rholoSigner } = device.kinds;
  /** @param {object} signer a stand-in @param {string} method @param {unknown[]} args */
  const call = (signer, method, args = []) =>
    /** @type {Promise<unknown>} each of a signer's methods is async */ (
      rholoSigner.deliver(String(krefs.get(signer)).split(':')[1], method, args)
    );
  return {
    keyMap,
    keyMapRef,
    /** @param {unknown[]} args */
    make: (...args) =>
      /** @type {object} a stand-in */ (
        rholoSigners.deliver('1', 'make', args)
      ),
    call,
    /** @param {object} signer @param {Record<string, unknown>} deploy */
    sign: (signer, deploy) =>
      /** @type {Promise<SignedDeploy>} */ (call(signer, 'sign', [deploy])),
  };
};

const deploy = harden({
  term: 'new x in { x!(1) }',
  timestamp: 1_764_000_000_000,
  phloPrice: 1,
  phloLimit: 500_000,
  validAfterBlockNumber: 42,
});

/** Whether `signed` is signed by the key its `deployer` names, over blake2b-256 of its data. @param {SignedDeploy} signed */
const verifies = signed =>
  secp256k1.verify(
    secp256k1.Signature.fromDER(signed.signature).toCompactRawBytes(),
    blake2b(encodeDeployData(signed.data), { dkLen: 32 }),
    hexToBytes(signed.deployer),
  );

test('a signer signs a deploy for its shard with the key in its map', async () => {
  const { keyMap, keyMapRef, make, sign } = setup();
  keyMap.set('privateKey', KEY1);
  const signer = make(keyMapRef, '/testnet', 1_000_000);
  const signed = await sign(signer, deploy);
  assert.deepEqual(signed.data, { ...deploy, shardId: '/testnet' });
  assert.equal(signed.sigAlgorithm, 'secp256k1');
  assert.equal(
    signed.deployer,
    Buffer.from(secp256k1.getPublicKey(hexToBytes(KEY1), false)).toString(
      'hex',
    ),
  );
  assert.ok(verifies(signed));
});

test('a deploy may not name another shard, or spend more phlo than the signer allows', async () => {
  const { keyMap, keyMapRef, make, sign } = setup();
  keyMap.set('privateKey', KEY1);
  const signer = make(keyMapRef, '/testnet', 1_000_000);
  await assert.rejects(sign(signer, { ...deploy, shardId: '/mainnet' }));
  await assert.rejects(
    sign(signer, { ...deploy, phloLimit: 1_000_001 }),
    /phloLimit/,
  );
  await assert.rejects(
    sign(signer, { ...deploy, timestamp: 1.5 }),
    /timestamp/,
  );
});

test('the keeper rotates the key under a signer already given out', async () => {
  const { keyMap, keyMapRef, make, call } = setup();
  keyMap.set('privateKey', KEY1);
  const signer = make(keyMapRef, '/testnet', 1_000_000);
  const before = await call(signer, 'getRevAddress');
  keyMap.set('privateKey', `0x${KEY2}`);
  const after = await call(signer, 'getRevAddress');
  assert.notEqual(before, after);
  assert.match(String(after), /^1111[1-9A-HJ-NP-Za-km-z]+$/);
});

test("a key that isn't one is refused, without quoting it", async () => {
  const { keyMap, keyMapRef, make, call } = setup();
  keyMap.set('privateKey', 'sekrit');
  const signer = make(keyMapRef, '/testnet', 1_000_000);
  await assert.rejects(call(signer, 'getDeployer'), e => {
    assert.ok(e instanceof Error);
    assert.doesNotMatch(e.message, /sekrit/);
    return true;
  });
});

test('make takes only a reference the kernel handed out', () => {
  const { make } = setup();
  assert.throws(() => make(Far('stranger', {}), '/testnet', 1), /handed out/);
});
