/** @file Crypto devices, and the JWT and rholo signers a definition builds from them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { blake2b } from '@noble/hashes/blake2b';
import { sha256 } from '@noble/hashes/sha2';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { E, Far } from '@endo/far';
import { TABLES, makeCryptoDevices } from '../src/devices/crypto.js';
import { signJwt } from '../src/devices/jwt.js';
import { revAddressOf, signDeploy } from '../src/devices/rholo.js';
import { makeORM } from '../src/orm.js';
import { makeSql } from './memory-sql.js';
import { buildRootObject as buildJwtSigners } from '../examples/signers/jwt-signer.js';
import { buildRootObject as buildRholoSigners } from '../examples/signers/rholo-signer.js';
import { base58OfHex, derOfCompact } from '../examples/signers/bytes.js';

/** @import { Kref } from '../src/kernel/types.js' */
/** @import { Tables } from '../src/devices/crypto.js' */
/** @import { ORM } from '../src/orm.js' */

const SECP_KEY = '11'.repeat(32);
const ED_SEED = Buffer.from('22'.repeat(32), 'hex').toString('base64');

/** A crypto device over an in-memory table, and a key map, kept by the test, that `send` reads. */
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
  const device = makeCryptoDevices(
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
      subtle: crypto.subtle,
      send: async (kref, method) => {
        assert.equal(`${kref}.${method}`, 'ko1000.entries');
        return [...keyMap.entries()];
      },
    },
  );
  const { crypto: cryptoKind, cryptoSigner } = device.kinds;
  /** @param {string} method @param {unknown[]} args */
  const ask = (method, args = []) => cryptoKind.deliver('1', method, args);
  /**
   * A signer, as a definition holds one: each method delivered to the device.
   *
   * @param {'Ed25519' | 'P-256' | 'secp256k1'} algorithm
   */
  const signerFor = algorithm => {
    const standIn = /** @type {object} */ (
      ask('makeSigner', [keyMapRef, algorithm])
    );
    const rest = String(krefs.get(standIn)).split(':')[1];
    /** @param {string} method @param {unknown[]} args */
    const call = (method, args = []) =>
      /** @type {Promise<string>} */ (
        Promise.resolve(cryptoSigner.deliver(rest, method, args))
      );
    return Far('Signer', {
      getAlgorithm: () => call('getAlgorithm'),
      getPublicKey: () => call('getPublicKey'),
      /** @param {string} hex */
      sign: hex => call('sign', [hex]),
    });
  };
  const hashes = Far('Crypto', {
    /** @param {string} hex */
    blake2b256: hex => /** @type {string} */ (ask('blake2b256', [hex])),
    /** @param {string} hex */
    keccak256: hex => /** @type {string} */ (ask('keccak256', [hex])),
  });
  return { keyMap, keyMapRef, ask, signerFor, hashes };
};

test('hashes of hex, in hex', () => {
  const { ask } = setup();
  const msg = 'cafe';
  assert.equal(ask('sha256', [msg]), bytesToHex(sha256(hexToBytes(msg))));
  assert.equal(
    ask('blake2b256', [msg]),
    bytesToHex(blake2b(hexToBytes(msg), { dkLen: 32 })),
  );
  assert.equal(
    ask('keccak256', [msg]),
    bytesToHex(keccak_256(hexToBytes(msg))),
  );
  assert.throws(() => ask('sha256', ['xyz']), /hex/);
});

test('a secp256k1 signer signs a 32-byte digest, with low s', async () => {
  const { keyMap, signerFor } = setup();
  keyMap.set('privateKey', SECP_KEY);
  const signer = signerFor('secp256k1');
  const digest = 'ab'.repeat(32);
  const sig = await E(signer).sign(digest);
  const publicKey = await E(signer).getPublicKey();
  assert.equal(publicKey.length, 130);
  assert.ok(
    secp256k1.verify(
      hexToBytes(sig),
      hexToBytes(digest),
      hexToBytes(publicKey),
      { lowS: true },
    ),
  );
  await assert.rejects(E(signer).sign('ab'), /32-byte digest/);
});

test('an Ed25519 signer signs a message', async () => {
  const { keyMap, signerFor } = setup();
  keyMap.set('privateKey', ED_SEED);
  const signer = signerFor('Ed25519');
  const sig = await E(signer).sign('68656c6c6f');
  assert.ok(
    ed25519.verify(
      hexToBytes(sig),
      hexToBytes('68656c6c6f'),
      hexToBytes(await E(signer).getPublicKey()),
    ),
  );
});

test('a P-256 signer signs a message as ES256 does: SHA-256, then r ‖ s', async () => {
  const { keyMap, signerFor } = setup();
  const pair = /** @type {CryptoKeyPair} ECDSA generates a pair */ (
    await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )
  );
  const p8 = Buffer.from(
    await crypto.subtle.exportKey('pkcs8', pair.privateKey),
  ).toString('base64');
  keyMap.set(
    'privateKey',
    `-----BEGIN PRIVATE KEY-----\n${p8}\n-----END PRIVATE KEY-----`,
  );
  const signer = signerFor('P-256');
  const sig = await E(signer).sign('68656c6c6f');
  assert.ok(
    await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      new Uint8Array(hexToBytes(sig)),
      new Uint8Array(hexToBytes('68656c6c6f')),
    ),
  );
  assert.equal(
    await E(signer).getPublicKey(),
    bytesToHex(
      new Uint8Array(
        /** @type {ArrayBuffer} raw export */ (
          await crypto.subtle.exportKey('raw', pair.publicKey)
        ),
      ),
    ),
  );
});

test('a key for another algorithm is refused, without quoting it', async () => {
  const { keyMap, signerFor } = setup();
  keyMap.set('privateKey', ED_SEED);
  await assert.rejects(E(signerFor('P-256')).sign('00'), e => {
    assert.ok(e instanceof Error);
    assert.match(e.message, /not a key/);
    assert.doesNotMatch(e.message, new RegExp(ED_SEED.slice(0, 12)));
    return true;
  });
  keyMap.set('privateKey', 'sekrit');
  await assert.rejects(E(signerFor('secp256k1')).getPublicKey(), e => {
    assert.ok(e instanceof Error);
    assert.doesNotMatch(e.message, /sekrit/);
    return true;
  });
});

test('makeSigner takes only a reference the kernel handed out', () => {
  const { ask } = setup();
  assert.throws(
    () => ask('makeSigner', [Far('stranger', {}), 'Ed25519']),
    /handed out/,
  );
});

test("bytes: base58 and DER as rholo's addresses and signatures have them", () => {
  assert.equal(base58OfHex('0000ff'), '115Q');
  const sig = secp256k1.sign('ab'.repeat(32), SECP_KEY, { lowS: true });
  assert.equal(
    derOfCompact(bytesToHex(sig.toCompactRawBytes())),
    bytesToHex(sig.toDERRawBytes()),
  );
});

const deploy = harden({
  term: 'new x in { x!("héllo") }',
  timestamp: 1_764_000_000_000,
  phloPrice: 1,
  phloLimit: 500_000,
  validAfterBlockNumber: 42,
});

test("a definition's rholo signer signs as the rholoSigners device does", async () => {
  const { keyMap, signerFor, hashes } = setup();
  keyMap.set('privateKey', SECP_KEY);
  const signers = buildRholoSigners(
    { E, Far },
    { crypto: hashes, key: signerFor('secp256k1') },
  );
  const signer = signers.make('/testnet', 1_000_000);
  const key = hexToBytes(SECP_KEY);
  assert.deepEqual(
    await signer.sign(deploy),
    signDeploy(key, { ...deploy, shardId: '/testnet' }),
  );
  assert.equal(
    await signer.getRevAddress(),
    revAddressOf(secp256k1.getPublicKey(key, false)),
  );
  await assert.rejects(
    signer.sign({ ...deploy, phloLimit: 1_000_001 }),
    /phloLimit/,
  );
  await assert.rejects(
    // @ts-expect-error the signer sets the shard
    signer.sign({ ...deploy, shardId: '/mainnet' }),
    /not yours to set/,
  );
});

test("a definition's JWT signer signs as the jwtSigners device does", async () => {
  const { keyMap, signerFor } = setup();
  keyMap.set('privateKey', ED_SEED);
  const now = 1_764_000_000_123;
  const signers = buildJwtSigners(
    { E, Far },
    {
      key: signerFor('Ed25519'),
      timer: Far('Timer', { now: () => now }),
      entropy: Far('Entropy', { swiss: () => 'n0nce' }),
    },
  );
  const signer = signers.make('k1', { aud: 'api', sub: 'bot' }, 60);
  const nbf = Math.floor(now / 1000);
  assert.equal(
    await signer.sign({ uri: 'GET /x' }),
    await signJwt(
      crypto.subtle,
      ED_SEED,
      { kid: 'k1', nonce: 'n0nce', typ: 'JWT' },
      { aud: 'api', sub: 'bot', uri: 'GET /x', nbf, exp: nbf + 60 },
    ),
  );
  await assert.rejects(signer.sign({ aud: 'other' }), /not yours to set/);
  assert.throws(() => signers.make('k1', { exp: '1' }), /stamps exp/);
});
