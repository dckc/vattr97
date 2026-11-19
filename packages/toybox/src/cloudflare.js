/**
 * @file toybox as a Cloudflare Worker: the app socket is its `fetch`, and
 * entrypoints stand in for what config.capnp gives the kernel from disks
 * and networks. There is no admin socket and no http socket.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import BOOT_TREE from 'toybox-boot';
import { App } from './supervisor.js';

export { Directory, Kernel, Syscall } from './supervisor.js';

/** @import { BootTree } from 'toybox-boot' */

/**
 * Answer `request` from `tree` as workerd's disk service answers from a
 * directory: a file as its bytes, `application/octet-stream`; a directory
 * as a JSON list of its entries' `{ name, type }`.
 *
 * @param {BootTree} tree
 * @param {Request} request
 */
const serveTree = (tree, request) => {
  /** @type {BootTree | string} */
  let node = tree;
  for (const segment of new URL(request.url).pathname.split('/')) {
    if (!segment) continue;
    const name = decodeURIComponent(segment);
    if (typeof node === 'string' || !Object.hasOwn(node, name))
      return new Response('not found\n', { status: 404 });
    node = node[name];
  }
  if (typeof node === 'string')
    return new Response(node, {
      headers: { 'content-type': 'application/octet-stream' },
    });
  return Response.json(
    Object.entries(node).map(([name, entry]) => ({
      name,
      type: typeof entry === 'string' ? 'file' : 'directory',
    })),
  );
};

/** The boot directory, read-only: built into the Worker from the directory build-cloudflare.js was given. */
export class Boot extends WorkerEntrypoint {
  /** @param {Request} request */
  fetch(request) {
    return serveTree(BOOT_TREE, request);
  }
}

/** The fetch device's network: the public internet, as the Worker reaches it. */
export class Internet extends WorkerEntrypoint {
  /** @param {Request} request */
  fetch(request) {
    // the Worker is Cloudflare's to construct, so the network enters here,
    // for the fetch device to hand out
    // eslint-disable-next-line no-restricted-globals
    return fetch(request);
  }
}

/** What a Worker has no counterpart for (the LAN, the nix store, a git checkout): every request fails, as on a network that allows nothing. */
export class Nowhere extends WorkerEntrypoint {
  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    throw new TypeError(`${new URL(request.url).host}: nothing reachable here`);
  }
}

export { App };
export default App;
