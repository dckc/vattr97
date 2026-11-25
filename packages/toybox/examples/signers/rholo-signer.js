/**
 * @file Rholo deploy signers, for a definition: built from a secp256k1
 * signer and the crypto device's hashes, as the kernel's `rholoSigners`
 * device's are. Its params: `crypto`, for blake2b and keccak, and `key`, a
 * secp256k1 signer from `E(crypto).makeSigner(keys.readOnly(), 'secp256k1')`.
 * Its root makes signers for one shard, under a phlo limit.
 *
 * @see https://github.com/rhovision-org/rholo/blob/dev/docs/src/developer/building-apps.md
 */
import {
  base58OfHex,
  derOfCompact,
  fail,
  utf8Hex,
  varintHex,
} from './bytes.js';

/**
 * @typedef {object} DeployData what a deploy says, and its signature covers
 * @property {string} term Rholang source
 * @property {number} timestamp milliseconds since the epoch
 * @property {number} phloPrice
 * @property {number} phloLimit
 * @property {number} validAfterBlockNumber
 * @property {string} shardId
 */

/** What a deploy given to `sign` says; the signer adds the shard. */
const DEPLOY_FIELDS = harden([
  'term',
  'timestamp',
  'phloPrice',
  'phloLimit',
  'validAfterBlockNumber',
]);

/**
 * DeployDataProto as the node signs it (models/proto/casper.proto), in
 * hex: the fields a signature covers, defaults omitted as proto3 does.
 *
 * @param {DeployData} data
 */
export const encodeDeployData = data => {
  /** @param {number} field @param {string} s */
  const str = (field, s) => {
    if (!s) return '';
    const hex = utf8Hex(s);
    return varintHex((field << 3) | 2) + varintHex(hex.length / 2) + hex;
  };
  /** @param {number} field @param {number} n */
  const int = (field, n) => (n ? varintHex(field << 3) + varintHex(n) : '');
  return [
    str(2, data.term),
    int(3, data.timestamp),
    int(7, data.phloPrice),
    int(8, data.phloLimit),
    int(10, data.validAfterBlockNumber),
    str(11, data.shardId),
  ].join('');
};

/**
 * @typedef {object} Crypto the crypto device's hashes, of hex, in hex
 * @property {(hex: string) => string} blake2b256
 * @property {(hex: string) => string} keccak256
 */

/**
 * @typedef {object} Key a secp256k1 signer
 * @property {() => Promise<string>} getPublicKey uncompressed, in hex
 * @property {(digest: string) => Promise<string>} sign r ‖ s, low s, in hex
 */

/**
 * @param {{ E: (x: any) => any, Far: typeof import('@endo/far').Far }} powers
 * @param {{ crypto: Crypto, key: Key }} params
 */
export const buildRootObject = ({ E, Far }, { crypto, key }) => {
  /** @param {string} hex */
  const blake2b256 = hex => E(crypto).blake2b256(hex);

  /**
   * The REV address of a public key: base58 of the coin id, version,
   * keccak of the eth address, and a blake2b checksum
   * (rholang/src/util/rev_address.rs).
   *
   * @param {string} publicKey uncompressed, in hex
   */
  const revAddressOf = async publicKey => {
    const eth = (await E(crypto).keccak256(publicKey.slice(2))).slice(-40);
    const payload = `00000000${await E(crypto).keccak256(eth)}`;
    const checksum = (await blake2b256(payload)).slice(0, 8);
    return base58OfHex(payload + checksum);
  };

  /** @param {unknown} n @param {string} what */
  const whole = (n, what) => {
    if (!Number.isSafeInteger(n) || /** @type {number} */ (n) < 0)
      throw Error(`${what}: ${n} is not a whole number`);
  };

  return Far('RholoSigners', {
    /**
     * A signer of deploys for `shardId` that spend at most `maxPhloLimit`.
     *
     * @param {string} shardId such as `/testnet`, as the node's `status` says
     * @param {number} maxPhloLimit
     */
    make(shardId, maxPhloLimit) {
      typeof shardId === 'string' || fail('shardId: not a string');
      whole(maxPhloLimit, 'maxPhloLimit');
      return Far('RholoSigner', {
        getShardId: () => shardId,
        getMaxPhloLimit: () => maxPhloLimit,
        /** The public key deploys are signed with, uncompressed, in hex. */
        getDeployer: () => E(key).getPublicKey(),
        /** The REV address that pays for the deploys it signs. */
        getRevAddress: async () => revAddressOf(await E(key).getPublicKey()),
        /**
         * `deploy`, for this signer's shard, signed: the body of a node's
         * `POST /api/v1/deploy`.
         *
         * @param {Omit<DeployData, 'shardId'>} deploy
         */
        async sign(deploy) {
          const extra = Object.keys(deploy).filter(
            k => !DEPLOY_FIELDS.includes(k),
          );
          if (extra.length)
            throw Error(`sign: ${extra.join(', ')} is not yours to set`);
          const {
            term,
            timestamp,
            phloPrice,
            phloLimit,
            validAfterBlockNumber,
          } = deploy;
          typeof term === 'string' || fail('term: not a string');
          whole(timestamp, 'timestamp');
          whole(phloPrice, 'phloPrice');
          whole(phloLimit, 'phloLimit');
          whole(validAfterBlockNumber, 'validAfterBlockNumber');
          if (phloLimit > maxPhloLimit)
            throw Error(`phloLimit: ${phloLimit} is more than ${maxPhloLimit}`);
          const data = harden({
            term,
            timestamp,
            phloPrice,
            phloLimit,
            validAfterBlockNumber,
            shardId,
          });
          const digest = await blake2b256(encodeDeployData(data));
          const [deployer, compact] = await Promise.all([
            E(key).getPublicKey(),
            E(key).sign(digest),
          ]);
          return harden({
            data,
            deployer,
            signature: derOfCompact(compact),
            sigAlgorithm: 'secp256k1',
          });
        },
      });
    },
  });
};
