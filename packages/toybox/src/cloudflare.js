/**
 * @file toybox as a Cloudflare Worker: the app socket is its `fetch`, and
 * entrypoints stand in for what config.capnp gives the kernel from disks
 * and networks. There is no admin socket and no http socket; in place of
 * the admin socket's one use for a person, `POST /.toybox/owner` with the
 * `OWNER_KEY` secret as its body answers the boot vat's owner link.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import BOOT_TREE from 'toybox-boot';
import SOURCE_TREE from 'toybox-source';
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

/** The source directory, read-only: built into the Worker, as the boot directory is. */
export class Source extends WorkerEntrypoint {
  /** @param {Request} request */
  fetch(request) {
    return serveTree(SOURCE_TREE, request);
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

const OWNER_PATH = '/.toybox/owner';

/**
 * Whether `given` is `key`, in time that says nothing of where they differ.
 *
 * @param {string} given
 * @param {string} key
 */
const sameKey = async (given, key) => {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all(
    [given, key].map(s => crypto.subtle.digest('SHA-256', encoder.encode(s))),
  );
  return crypto.subtle.timingSafeEqual(a, b);
};

/**
 * The app socket, and `POST /.toybox/owner`: a body that is the
 * `OWNER_KEY` secret gets the boot vat's owner link, a fragment such as
 * `#agent=…`, so the key travels only in a request body and the link's
 * swiss number only in a fragment. Without the secret, there is no such
 * route, and the path is the boot vat's like any other.
 */
/** @extends {App} */
export class Front extends App {
  /** @param {Request} request */
  async fetch(request) {
    const key = this.env.OWNER_KEY;
    if (!key || new URL(request.url).pathname !== OWNER_PATH)
      return super.fetch(request);
    if (request.method !== 'POST')
      return new Response('POST the owner key, please\n', {
        status: 405,
        headers: { allow: 'POST' },
      });
    if (!(await sameKey((await request.text()).trim(), key)))
      return new Response('not the owner key\n', { status: 403 });
    const link = await this.env.KERNEL.getByName('main').provideOwnerLink();
    return new Response(`${link}\n`, {
      headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
    });
  }
}

export { App };
export default Front;
