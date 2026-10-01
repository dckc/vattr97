// @ts-check
import harden from '@endo/harden';
import { encodeBase32 } from './base32.js';

/** CIDv1, `raw` codec, sha2-256 multihash with a 32 byte digest. */
const RAW_SHA256_PREFIX = [0x01, 0x55, 0x12, 0x20];

const RAW_CID = /^bafkrei[a-z2-7]{52}$/;

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export const isRawCid = value =>
  typeof value === 'string' && RAW_CID.test(value);
harden(isRawCid);

/**
 * @param {object} powers
 * @param {(bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>>} powers.sha256
 */
export const makeCidTools = ({ sha256 }) => {
  /**
   * The CID that names `bytes` as a single raw IPFS block.
   *
   * @param {Uint8Array<ArrayBuffer>} bytes
   * @returns {Promise<string>}
   */
  const rawCidOf = async bytes => {
    const digest = await sha256(bytes);
    const cidBytes = new Uint8Array(RAW_SHA256_PREFIX.length + digest.length);
    cidBytes.set(RAW_SHA256_PREFIX, 0);
    cidBytes.set(digest, RAW_SHA256_PREFIX.length);
    return `b${encodeBase32(cidBytes)}`;
  };

  return harden({ rawCidOf });
};
harden(makeCidTools);
