/** @file JWT signers: short-lived JWTs, signed with a key read from someone's map store, stamped with the time and a nonce. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Far } from '@endo/far';
import { makeJwtSigners, parseKey, TABLES } from '../src/devices/jwt.js';
import { makeORM } from '../src/orm.js';
import { makeSql } from './memory-sql.js';

/** @import { Kref } from '../src/kernel/types.js' */
/** @import { Tables } from '../src/devices/jwt.js' */
/** @import { ORM } from '../src/orm.js' */

const { subtle } = webcrypto;

/** @param {string} part */
const fromUrl = part => new Uint8Array(Buffer.from(part, 'base64url'));
/** @param {string} part */
const jsonOf = part => JSON.parse(new TextDecoder().decode(fromUrl(part)));

/** An ES256 key, as Coinbase hands one out (SEC1 PEM), and its public half. */
const es256 = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return {
    text: /** @type {string} */ (
      privateKey.export({ format: 'pem', type: 'sec1' })
    ),
    publicKey,
  };
};

/** An Ed25519 key as base64 of seed then public key, and its public half. */
const ed25519 = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(16);
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return {
    text: Buffer.concat([seed, pub]).toString('base64'),
    publicKey,
  };
};

/**
 * A signer device over an in-memory table, a clock the test sets, and a
 * key map, kept by the test, that `send` reads.
 */
const setup = () => {
  const sql = makeSql(new DatabaseSync(':memory:'));
  for (const ddl of Object.values(TABLES)) sql.exec(ddl);
  let t = 1_700_000_000_123;
  let n = 0;
  /** @type {Map<string, unknown>} */
  const keyMap = new Map();
  const keyMapRef = Far('readOnly', {});
  /** @type {WeakMap<object, Kref>} */
  const krefs = new WeakMap();
  krefs.set(keyMapRef, 'ko1000');
  const device = makeJwtSigners(
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
      now: () => t,
      random: k => new Uint8Array(k).fill(0xab),
      subtle,
      send: async (kref, method) => {
        assert.equal(`${kref}.${method}`, 'ko1000.entries');
        return [...keyMap.entries()];
      },
    },
  );
  const { jwtSigners, jwtSigner } = device.kinds;
  return {
    keyMap,
    keyMapRef,
    at: (/** @type {number} */ ms) => {
      t = ms;
    },
    /** @param {unknown[]} args */
    make: (...args) =>
      /** @type {object} a stand-in */ (jwtSigners.deliver('1', 'make', args)),
    /** @param {object} signer a stand-in @param {Record<string, unknown>} claims */
    sign: (signer, claims) =>
      /** @type {Promise<string>} a JWT */ (
        jwtSigner.deliver(String(krefs.get(signer)).split(':')[1], 'sign', [
          claims,
        ])
      ),
  };
};

/** Whether `jwt` is signed by `publicKey`. @param {string} jwt @param {import('node:crypto').KeyObject} publicKey */
const verifies = async (jwt, publicKey) => {
  const [h, c, s] = jwt.split('.');
  const { alg } = jsonOf(h);
  const algorithm =
    alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'Ed25519' };
  const key = await subtle.importKey(
    'spki',
    publicKey.export({ format: 'der', type: 'spki' }),
    alg === 'ES256' ? { name: 'ECDSA', namedCurve: 'P-256' } : 'Ed25519',
    false,
    ['verify'],
  );
  return subtle.verify(
    algorithm,
    key,
    fromUrl(s),
    new TextEncoder().encode(`${h}.${c}`),
  );
};

test('a signer signs ES256 with the key in its map: kid, nonce, fixed claims, nbf now, exp ttl later', async () => {
  const { keyMap, keyMapRef, make, sign } = setup();
  const { text, publicKey } = es256();
  keyMap.set('privateKey', text);
  const signer = make(keyMapRef, 'org/key1', { iss: 'cdp', sub: 'org/key1' });
  const jwt = await sign(signer, { uri: 'GET example.com/accounts' });
  const [h, c] = jwt.split('.');
  assert.deepEqual(jsonOf(h), {
    alg: 'ES256',
    kid: 'org/key1',
    nonce: 'ab'.repeat(16),
    typ: 'JWT',
  });
  assert.deepEqual(jsonOf(c), {
    iss: 'cdp',
    sub: 'org/key1',
    uri: 'GET example.com/accounts',
    nbf: 1_700_000_000,
    exp: 1_700_000_120,
  });
  assert.ok(await verifies(jwt, publicKey));
});

test('Ed25519, as base64 of seed and public key, signs as EdDSA', async () => {
  const { keyMap, keyMapRef, make, sign } = setup();
  const { text, publicKey } = ed25519();
  keyMap.set('privateKey', text);
  const jwt = await sign(make(keyMapRef, 'k', {}, 60), {});
  assert.equal(jsonOf(jwt.split('.')[0]).alg, 'EdDSA');
  assert.equal(
    jsonOf(jwt.split('.')[1]).exp - jsonOf(jwt.split('.')[1]).nbf,
    60,
  );
  assert.ok(await verifies(jwt, publicKey));
});

test('Ed25519 as PKCS #8 PEM signs as EdDSA, not ES256', async () => {
  const { keyMap, keyMapRef, make, sign } = setup();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  keyMap.set('privateKey', privateKey.export({ format: 'pem', type: 'pkcs8' }));
  const jwt = await sign(make(keyMapRef, 'k', {}), {});
  assert.equal(jsonOf(jwt.split('.')[0]).alg, 'EdDSA');
  assert.ok(await verifies(jwt, publicKey));
});

test("the keeper rotates the key under a signer already made; a PEM pasted with literal \\n's reads", async () => {
  const { keyMap, keyMapRef, make, sign } = setup();
  const signer = make(keyMapRef, 'k', {});
  const one = es256();
  keyMap.set('privateKey', one.text);
  assert.ok(await verifies(await sign(signer, {}), one.publicKey));
  const two = es256();
  keyMap.set('privateKey', two.text.replaceAll('\n', '\\n'));
  const jwt = await sign(signer, {});
  assert.ok(await verifies(jwt, two.publicKey));
  assert.equal(await verifies(jwt, one.publicKey), false);
});

test("sign can't set a fixed or stamped claim; make can't fix a stamped one, or a long life", async () => {
  const { keyMap, keyMapRef, make, sign } = setup();
  keyMap.set('privateKey', es256().text);
  const signer = make(keyMapRef, 'k', { sub: 'me' });
  await assert.rejects(sign(signer, { sub: 'you' }), /sub is not yours/);
  await assert.rejects(sign(signer, { exp: '9999999999' }), /exp is not yours/);
  assert.throws(() => make(keyMapRef, 'k', { nbf: '0' }), /stamps nbf/);
  assert.throws(() => make(keyMapRef, 'k', {}, 3600), /ttl/);
  assert.throws(() => make(Far('stranger', {}), 'k', {}), /kernel handed out/);
});

test('no key, or not a key, fails without quoting what the map holds', async () => {
  const { keyMap, keyMapRef, make, sign } = setup();
  const signer = make(keyMapRef, 'k', {});
  await assert.rejects(sign(signer, {}), /no privateKey/);
  keyMap.set('privateKey', 'hunter2!');
  await assert.rejects(sign(signer, {}), (/** @type {unknown} */ err) => {
    assert.match(String(err), /not a key/);
    assert.doesNotMatch(String(err), /hunter2/);
    return true;
  });
  assert.throws(
    () =>
      parseKey('-----BEGIN RSA PRIVATE KEY-----x-----END RSA PRIVATE KEY-----'),
    /not a key/,
  );
});
