import { createHash } from 'node:crypto';
import { Response } from 'miniflare';
import { encodeBase32 } from '../src/base32.js';

/**
 * An in-memory stand-in for the two Kubo endpoints the Worker uses: block
 * put on the RPC API and raw block get on the gateway.
 *
 * @returns {(request: import('miniflare').Request) => Promise<Response>}
 */
export const makeFakeKubo = () => {
  /** @type {Map<string, Uint8Array>} */
  const blocks = new Map();

  return async request => {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/v0/block/put') {
      const form = await request.formData();
      const bytes = new Uint8Array(await form.get('data').arrayBuffer());
      const digest = createHash('sha256').update(bytes).digest();
      const cid = `b${encodeBase32(
        Uint8Array.from([0x01, 0x55, 0x12, 0x20, ...digest]),
      )}`;
      blocks.set(cid, bytes);
      return Response.json({ Key: cid, Size: bytes.length });
    }
    const match = /^\/ipfs\/([a-z2-7]+)$/.exec(url.pathname);
    if (request.method === 'GET' && match) {
      const bytes = blocks.get(match[1]);
      return bytes
        ? new Response(bytes, {
            headers: { 'Content-Type': 'application/vnd.ipld.raw' },
          })
        : new Response('not found', { status: 404 });
    }
    return new Response('unexpected request', { status: 500 });
  };
};
