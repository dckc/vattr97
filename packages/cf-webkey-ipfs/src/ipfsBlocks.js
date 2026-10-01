// @ts-check
import harden from '@endo/harden';
import { isRawCid } from './cid.js';

/**
 * @typedef {object} Blocks content-addressed storage for raw blocks
 * @property {(bytes: Uint8Array<ArrayBuffer>) => Promise<string>} put resolves to the CID
 * @property {(cid: string) => Promise<Uint8Array<ArrayBuffer>>} get
 */

/**
 * Raw blocks on IPFS: written through a Kubo RPC API, read through a
 * trustless gateway. Neither endpoint is trusted for integrity; every block
 * is checked against its CID.
 *
 * @param {object} powers
 * @param {typeof fetch} powers.fetch
 * @param {string} powers.apiUrl Kubo RPC API origin
 * @param {string} powers.gatewayUrl trustless gateway origin
 * @param {(bytes: Uint8Array<ArrayBuffer>) => Promise<string>} powers.rawCidOf
 * @returns {Blocks}
 */
export const makeIpfsBlocks = ({ fetch, apiUrl, gatewayUrl, rawCidOf }) => {
  /** @param {Uint8Array<ArrayBuffer>} bytes */
  const put = async bytes => {
    const expected = await rawCidOf(bytes);
    const body = new FormData();
    body.append('data', new Blob([bytes]));
    const res = await fetch(
      `${apiUrl}/api/v0/block/put?cid-codec=raw&mhtype=sha2-256&pin=true`,
      { method: 'POST', body },
    );
    if (!res.ok) {
      throw Error(`IPFS block put failed: ${res.status}`);
    }
    const { Key } = /** @type {{ Key: string }} */ (await res.json());
    if (Key !== expected) {
      throw Error(`IPFS stored ${Key}, expected ${expected}`);
    }
    return expected;
  };

  /** @param {string} cid */
  const get = async cid => {
    if (!isRawCid(cid)) {
      throw TypeError('not a raw sha2-256 CID');
    }
    const res = await fetch(`${gatewayUrl}/ipfs/${cid}?format=raw`, {
      headers: { Accept: 'application/vnd.ipld.raw' },
    });
    if (!res.ok) {
      throw Error(`IPFS block get failed: ${res.status}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if ((await rawCidOf(bytes)) !== cid) {
      throw Error(`block does not match ${cid}`);
    }
    return bytes;
  };

  return harden({ put, get });
};
harden(makeIpfsBlocks);
