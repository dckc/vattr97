/** @file Fetch and LAN devices, after SwingSet's devices: HTTP for vats, as data. */

import { M } from '@endo/patterns';
import { kzone } from './objects.js';

/** @import { Device, FetchAnswer, FetchInit, KernelPowers } from '../types.js' */

const { fromEntries } = Object;

/**
 * A fetch device over `fetch`.
 *
 * @param {(request: Request) => Promise<Response>} fetch where requests go
 */
export const makeFetchDevice = fetch =>
  harden({
    /**
     * @param {string} url
     * @param {FetchInit} [init]
     * @returns {Promise<FetchAnswer>}
     */
    async fetch(url, { method, headers, body } = {}) {
      const resp = await fetch(new Request(url, { method, headers, body }));
      return harden({
        status: resp.status,
        headers: fromEntries(resp.headers),
        body: await resp.text(),
      });
    },
  });

/**
 * Fetch devices, after SwingSet's devices: a vat given one calls
 * `fetch(url, init)` and gets `{ status, headers, body }` back, as data, so
 * requests and answers can cross the kernel. A fetch device reaches what
 * config.capnp's `internet` service allows; a LAN device, what its `lan`
 * service allows. Neither attenuates anything: a WebApp vat
 * (kvats/webapp.js) does that.
 *
 * The kernel's fetch devices over the network service `net`: every one
 * reaches the same addresses, so they differ only by who holds them.
 *
 * @param {KernelPowers} powers
 * @param {object} io
 * @param {string} io.tag `FetchDevice` or `LanDevice`
 * @param {string} io.prefix their keys' prefix
 * @param {{ fetch: (request: Request) => Promise<Response> }} io.net
 * @returns {Device}
 */
export const makeFetchDevices = (
  { next, kernelObject },
  { tag, prefix, net },
) => {
  const device = makeFetchDevice(request => net.fetch(request));
  return harden({
    kinds: {
      [prefix]: kzone.exoClass(
        tag,
        M.interface(tag, {
          fetch: M.call(M.string())
            .optional(
              M.splitRecord(
                {},
                {
                  method: M.string(),
                  headers: M.recordOf(M.string(), M.string()),
                  body: M.string(),
                },
              ),
            )
            .returns(M.promise()),
        }),
        {
          /** @param {string} url @param {FetchInit} [init] */
          fetch: (url, init) => device.fetch(url, init),
        },
      ),
    },
    /** A device: whoever holds it can fetch anything `net` reaches. */
    make: () => kernelObject(`${prefix}:${next(prefix)}`),
  });
};
