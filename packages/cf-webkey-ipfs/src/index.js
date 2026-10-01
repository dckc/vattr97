// @ts-check
import { DurableObject } from 'cloudflare:workers';
import { newWorkersRpcResponse } from 'capnweb';
import harden from '@endo/harden';
import { makeGate } from './caps.js';
import { makeCidTools } from './cid.js';
import { makeCipher } from './cipher.js';
import { makeFileStore } from './files.js';
import { makeIpfsBlocks } from './ipfsBlocks.js';
import { makeRefTable } from './refTable.js';
import { makeSecretTools } from './secrets.js';
import { makeSqlRowStore } from './sqlRowStore.js';

/**
 * Assemble the service from the authority it needs and no more.
 *
 * @param {object} powers
 * @param {SqlStorage} powers.sql
 * @param {SubtleCrypto} powers.subtle
 * @param {(bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>} powers.getRandomValues
 * @param {typeof fetch} powers.fetch
 * @param {() => number} powers.now
 * @param {{ apiUrl: string, gatewayUrl: string }} powers.ipfs
 */
export const makeService = ({
  sql,
  subtle,
  getRandomValues,
  fetch,
  now,
  ipfs,
}) => {
  /** @param {Uint8Array<ArrayBuffer>} bytes */
  const sha256 = async bytes =>
    new Uint8Array(await subtle.digest('SHA-256', bytes));
  const { rawCidOf } = makeCidTools({ sha256 });
  const blocks = makeIpfsBlocks({ fetch, rawCidOf, ...ipfs });
  const cipher = makeCipher({ subtle, getRandomValues });
  const files = makeFileStore({ blocks, cipher });
  const secrets = makeSecretTools({ subtle, getRandomValues });
  const refTable = makeRefTable({ store: makeSqlRowStore(sql), secrets, now });
  return makeGate({ refTable, files, now });
};
harden(makeService);

/* eslint-disable no-restricted-syntax --
 * The Workers runtime requires a Durable Object to be a class. This one only
 * gathers ambient authority and hands it to `makeService`.
 */
export class VaultHost extends DurableObject {
  #gate;

  /**
   * @param {DurableObjectState} ctx
   * @param {Env} env
   */
  constructor(ctx, env) {
    super(ctx, env);
    this.#gate = makeService({
      sql: ctx.storage.sql,
      subtle: crypto.subtle,
      getRandomValues: bytes => crypto.getRandomValues(bytes),
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      ipfs: { apiUrl: env.IPFS_API, gatewayUrl: env.IPFS_GATEWAY },
    });
  }

  /** @param {Request} request */
  fetch(request) {
    return newWorkersRpcResponse(request, this.#gate);
  }
}
/* eslint-enable no-restricted-syntax */

export default harden({
  /**
   * @param {Request} request
   * @param {Env} env
   */
  fetch: (request, env) => {
    if (new URL(request.url).pathname !== '/api') {
      return new Response('Not found', { status: 404 });
    }
    return env.VAULT_HOST.getByName('main').fetch(request);
  },
});
