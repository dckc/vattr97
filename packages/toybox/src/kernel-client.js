/**
 * @file A client of a {@link Kernel} on the admin socket, from Node: its
 * presences are vrefs in its session's c-list, so they last as long as the
 * session. Run under SES (see node-lockdown.js).
 */
import { newWebSocketRpcSession } from 'capnweb';
import { makeLiveslots } from './vat/liveslots.js';

/**
 * @import { RpcStub } from 'capnweb';
 * @import { WebSocket } from 'ws';
 * @import { KernelSession } from './kernel.js';
 */

/**
 * A client of the kernel at the other end of `ws`: a WebSocket to the admin
 * socket's `/kernel/<name>`, which whoever holds the socket opens.
 *
 * @param {WebSocket} ws
 */
export const connectKernel = async ws => {
  await new Promise(
    (resolve, reject) => (ws.once('open', resolve), ws.once('error', reject)),
  );
  const session = /** @type {RpcStub<KernelSession>} */ (
    newWebSocketRpcSession(
      /** @type {any} ws implements the WHATWG WebSocket that capnweb types as the DOM's */ (
        ws
      ),
    )
  );
  const ls = makeLiveslots({
    send: (vref, method, capdata) => session.send(vref, method, capdata),
  });
  return harden({
    /**
     * Create a vat running `src`; `params` (presences included) reach its `buildRootObject`.
     *
     * @param {string} src
     * @param {Record<string, any>} [params]
     */
    createVat: async (src, params = {}) => {
      const { root, adminNode } = await session.createVat(
        src,
        ls.serialize(params),
      );
      return { root: ls.slotToVal(root), adminNode: ls.slotToVal(adminNode) };
    },
    /** Every vat's root and admin node, oldest first. */
    vats: async () =>
      (await session.vats()).map(({ root, adminNode }) => ({
        root: ls.slotToVal(root),
        adminNode: ls.slotToVal(adminNode),
      })),
    /** An I/O device, for a vat's params (devices/index.js). @param {string} name */
    makeDevice: async name => ls.slotToVal(await session.makeDevice(name)),
    /** A vatAdmin, for a bootstrap vat's params. */
    makeVatAdmin: async () => ls.slotToVal(await session.makeVatAdmin()),
    /** Keep `src`; its bundleCap is for a vatAdmin's `createVat`. @param {string} src */
    installBundle: async src => ls.slotToVal(await session.installBundle(src)),
    close: () => ws.close(),
  });
};
