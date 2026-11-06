/** @file toybox's entrypoint: the admin socket (`Admin`), in front of {@link Kernel}s. */
import '@endo/init';
import { WorkerEntrypoint } from 'cloudflare:workers';

import { makeDevices } from './devices/index.js';
import { makeKernelClass } from './kernel.js';

// config.capnp names these as classes of workerd's main module, this one
export { Syscall } from './kernel.js';

/** The kernel, with toybox's own I/O devices (devices/index.js). */
export const Kernel = makeKernelClass({ makeDevices });

/**
 * The admin socket: a WebSocket upgrade to `/kernel/<name>` reaches that
 * {@link Kernel}, whose session can make vats and devices.
 */
/** @extends {WorkerEntrypoint<Env>} */
export class Admin extends WorkerEntrypoint {
  /** @param {Request} request */
  async fetch(request) {
    const [, kernel, name] = new URL(request.url).pathname.split('/');
    if (
      request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' ||
      kernel !== 'kernel' ||
      !name
    )
      return new Response('a WebSocket to /kernel/<name>, please\n', {
        status: 400,
      });
    return this.env.KERNEL.getByName(name).fetch(request);
  }
}

export default Admin;
