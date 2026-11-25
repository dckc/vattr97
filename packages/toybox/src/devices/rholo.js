/**
 * @file rholo deploy signers: a vat holds a handle that signs deploys for
 * one shard with a secp256k1 key it can't read. As with the JWT signers
 * (./jwt.js), the key is kept in someone's map store: the signer holds the
 * store's `readOnly()` facet and reads the key at each signature, so the
 * store's keeper rotates it under handles already given out.
 *
 * A signer's shard and its phlo limit are set when it's made; a deploy it
 * signs can't name another shard or spend more phlo.
 *
 * @see https://github.com/rhovision-org/rholo/blob/dev/docs/src/developer/building-apps.md
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import { blake2b } from '@noble/hashes/blake2b';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base58 } from '@scure/base';
import { Fail, q } from '@endo/errors';
import { M } from '@endo/patterns';
import { kzone } from '../kernel/objects.js';

/** @import { Device, Kref, TablePowers } from '../kernel/types.js' */

const { fromEntries, keys } = Object;

export const TABLES = {
  // a signer: the key map it reads, its shard, and the most phlo a deploy may spend
  krholosigner:
    'CREATE TABLE IF NOT EXISTS krholosigner (id INTEGER PRIMARY KEY, keyMap TEXT NOT NULL, shardId TEXT NOT NULL, maxPhloLimit INTEGER NOT NULL)',
};

/** @typedef {{ krholosigner: { id: number, keyMap: Kref, shardId: string, maxPhloLimit: number } }} Tables */

/** The entry of a key map that holds the private key, as 64 hex digits. */
export const KEY_ENTRY = 'privateKey';

/**
 * @typedef {object} DeployData what a deploy says, and its signature covers
 * @property {string} term Rholang source
 * @property {number} timestamp milliseconds since the epoch
 * @property {number} phloPrice
 * @property {number} phloLimit
 * @property {number} validAfterBlockNumber
 * @property {string} shardId
 */

/**
 * @typedef {object} SignedDeploy the body of a node's `POST /api/v1/deploy`
 * @property {DeployData} data
 * @property {string} deployer the public key, uncompressed, in hex
 * @property {string} signature DER, in hex
 * @property {'secp256k1'} sigAlgorithm
 */

/** @param {Uint8Array} bytes */
const blake2b256 = bytes => blake2b(bytes, { dkLen: 32 });

/** A protobuf varint. @param {number} n */
const varint = n => {
  let v = BigInt(n);
  const out = [];
  do {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    out.push(v ? byte | 0x80 : byte);
  } while (v);
  return out;
};

/**
 * DeployDataProto as the node signs it (models/proto/casper.proto): the
 * fields a signature covers, defaults omitted as proto3 does.
 *
 * @param {DeployData} data
 */
export const encodeDeployData = data => {
  /** @type {number[]} */
  const out = [];
  /** @param {number} field @param {string} s */
  const str = (field, s) => {
    if (!s) return;
    const b = utf8ToBytes(s);
    out.push((field << 3) | 2, ...varint(b.length), ...b);
  };
  /** @param {number} field @param {number} n */
  const int = (field, n) => {
    if (n) out.push(field << 3, ...varint(n));
  };
  str(2, data.term);
  int(3, data.timestamp);
  int(7, data.phloPrice);
  int(8, data.phloLimit);
  int(10, data.validAfterBlockNumber);
  str(11, data.shardId);
  return Uint8Array.from(out);
};

/**
 * A REV address: base58 of the coin id, version, keccak of the eth
 * address, and a blake2b checksum (rholang/src/util/rev_address.rs).
 *
 * @param {Uint8Array} publicKey uncompressed, 65 bytes
 */
export const revAddressOf = publicKey => {
  const eth = keccak_256(publicKey.slice(1)).slice(-20);
  const payload = Uint8Array.from([0, 0, 0, 0, ...keccak_256(eth)]);
  const checksum = blake2b256(payload).slice(0, 4);
  return base58.encode(Uint8Array.from([...payload, ...checksum]));
};

/**
 * A private key from a key map's text: 64 hex digits, perhaps after `0x`.
 * Error messages never quote the key.
 *
 * @param {unknown} text
 */
export const parseKey = text => {
  if (typeof text !== 'string')
    throw Error(`the key map has no ${KEY_ENTRY} string`);
  const hex = text.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex))
    throw Error('not a key: a secp256k1 private key is 64 hex digits');
  return hexToBytes(hex);
};

/** @param {Uint8Array} privateKey */
export const publicKeyOf = privateKey =>
  secp256k1.getPublicKey(privateKey, false);

/**
 * `data`, signed with `privateKey`: ECDSA over blake2b-256 of its
 * protobuf encoding, low S, DER.
 *
 * @param {Uint8Array} privateKey
 * @param {DeployData} data
 * @returns {SignedDeploy}
 */
export const signDeploy = (privateKey, data) =>
  harden({
    data,
    deployer: bytesToHex(publicKeyOf(privateKey)),
    signature: bytesToHex(
      secp256k1
        .sign(blake2b256(encodeDeployData(data)), privateKey, { lowS: true })
        .toDERRawBytes(),
    ),
    sigAlgorithm: 'secp256k1',
  });

/** What a deploy given to `sign` says; the signer adds the shard. */
const DEPLOY_FIELDS = harden([
  'term',
  'timestamp',
  'phloPrice',
  'phloLimit',
  'validAfterBlockNumber',
]);

const Whole = M.and(M.number(), M.gte(0));
const Deploy = M.splitRecord({
  term: M.string(),
  timestamp: Whole,
  phloPrice: Whole,
  phloLimit: Whole,
  validAfterBlockNumber: Whole,
});

/** @param {unknown} n @param {string} what */
const whole = (n, what) =>
  Number.isSafeInteger(n) || Fail`${q(what)}: ${q(n)} is not a whole number`;

/**
 * The kernel's rholo deploy signers. `rholoSigners` is the maker:
 * `make(keyMap, shardId, maxPhloLimit)` answers a signer, whose
 * `sign(deploy)` answers the deploy, for its shard, signed, as a node's
 * `POST /api/v1/deploy` takes it.
 *
 * @param {TablePowers<Tables>} powers
 * @param {object} io
 * @param {(kref: Kref, method: string, args: unknown[]) => Promise<unknown>} io.send deliver to a vat's object
 * @returns {Device}
 */
export const makeRholoSigners = (
  { db, next, kernelObject, standIn, krefOf },
  { send },
) => {
  /** The key in a signer's key map, as it is now. @param {Kref} keyMap */
  const keyIn = async keyMap => {
    const found =
      /** @type {[string, unknown][]} entries() of the key map, as it answered */ (
        await send(keyMap, 'entries', [])
      );
    return parseKey(fromEntries(found)[KEY_ENTRY]);
  };
  /** @param {string} rest a signer's id */
  const rowOf = rest => db.lookup('krholosigner', { id: Number(rest) }).one();

  return harden({
    kinds: {
      rholoSigners: kzone.exoClass(
        'RholoSigners',
        M.interface('RholoSigners', {
          make: M.call(M.remotable(), M.string(), M.number()).returns(
            M.remotable(),
          ),
        }),
        {
          /**
           * A signer for `shardId` that reads its key from `keyMap`'s
           * `privateKey` entry.
           *
           * @param {object} keyMap anything with `entries()`, such as a map store's `readOnly()` facet
           * @param {string} shardId such as `/testnet`, as the node's `status` says
           * @param {number} maxPhloLimit the most phlo a deploy it signs may spend
           */
          make(keyMap, shardId, maxPhloLimit) {
            const kref = krefOf(keyMap);
            if (!kref)
              throw Error('make takes a reference the kernel handed out');
            whole(maxPhloLimit, 'maxPhloLimit');
            const id = next('rholoSigner');
            db.insert('krholosigner', {
              id,
              keyMap: kref,
              shardId,
              maxPhloLimit,
            });
            return standIn(kernelObject(`rholoSigner:${id}`));
          },
        },
      ),
      rholoSigner: kzone.exoClass(
        'RholoSigner',
        M.interface('RholoSigner', {
          getShardId: M.call().returns(M.string()),
          getMaxPhloLimit: M.call().returns(M.number()),
          getDeployer: M.callWhen().returns(M.string()),
          getRevAddress: M.callWhen().returns(M.string()),
          sign: M.callWhen(Deploy).returns(M.record()),
        }),
        {
          getShardId() {
            return rowOf(this.state.rest).shardId;
          },
          getMaxPhloLimit() {
            return rowOf(this.state.rest).maxPhloLimit;
          },
          /** The public key deploys are signed with, uncompressed, in hex. */
          async getDeployer() {
            const { keyMap } = rowOf(this.state.rest);
            return bytesToHex(publicKeyOf(await keyIn(keyMap)));
          },
          /** The REV address that pays for the deploys it signs. */
          async getRevAddress() {
            const { keyMap } = rowOf(this.state.rest);
            return revAddressOf(publicKeyOf(await keyIn(keyMap)));
          },
          /**
           * `deploy`, for this signer's shard, signed.
           *
           * @param {Omit<DeployData, 'shardId'>} deploy
           */
          async sign(deploy) {
            const { keyMap, shardId, maxPhloLimit } = rowOf(this.state.rest);
            const extra = keys(deploy).filter(k => !DEPLOY_FIELDS.includes(k));
            if (extra.length)
              throw Error(`sign: ${extra.join(', ')} is not yours to set`);
            const {
              term,
              timestamp,
              phloPrice,
              phloLimit,
              validAfterBlockNumber,
            } = deploy;
            whole(timestamp, 'timestamp');
            whole(phloPrice, 'phloPrice');
            whole(phloLimit, 'phloLimit');
            whole(validAfterBlockNumber, 'validAfterBlockNumber');
            phloLimit <= maxPhloLimit ||
              Fail`phloLimit: ${q(phloLimit)} is more than ${q(maxPhloLimit)}`;
            return signDeploy(
              await keyIn(keyMap),
              harden({
                term,
                timestamp,
                phloPrice,
                phloLimit,
                validAfterBlockNumber,
                shardId,
              }),
            );
          },
        },
      ),
    },
    /** A rholo signer maker: whoever holds it can make signers from key maps it holds. */
    make: () => kernelObject(`rholoSigners:${next('rholoSigners')}`),
  });
};
