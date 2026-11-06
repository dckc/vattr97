/**
 * @file Ingresses: a mount reserved in the Directory at some labels, which
 * the ingress's `serve(handler)` routes to. The kernel keeps the handler's
 * kref, so a request after any restart starts its vat if need be.
 */
import { M } from '@endo/patterns';
import { kzone } from './objects.js';

/** @import { IngressKey, Kref, TablePowers } from './types.js' */

export const TABLES = {
  // an ingress (a kernel object; its key is its vref) and the kref of whoever serves it
  kingress:
    'CREATE TABLE IF NOT EXISTS kingress (key TEXT PRIMARY KEY, handler TEXT)',
};

/** @typedef {{ kingress: { key: IngressKey, handler: Kref | null } }} Tables */

/**
 * @param {TablePowers<Tables>} powers
 * @param {object} io
 * @param {string} io.kernel this kernel's id, which an ingress's key names, so the Directory's mount leads back here
 * @param {{ mount: (key: IngressKey, labels: Record<string, string>) => Promise<void> }} io.directory
 */
export const makeIngresses = (
  { db, next, kernelObject, krefOf },
  { kernel, directory },
) =>
  harden({
    ...kzone.exoClass(
      'Ingress',
      M.interface('Ingress', {
        serve: M.call(M.remotable()).returns(M.undefined()),
      }),
      {
        /** Serve requests to this ingress's mount with `handler`'s `handle({ method, path, labels, body })`. @param {object} handler */
        serve(handler) {
          const kref = krefOf(handler);
          if (!kref)
            throw Error('serve takes a reference the kernel handed out');
          db.lookup('kingress', { key: `kernel:${this.state.rest}` }).update({
            handler: kref,
          });
        },
      },
    ),
    /**
     * Reserve a mount at `labels`; answers the ingress for it.
     *
     * @param {Record<string, string>} labels
     */
    async make(labels) {
      for (const [k, v] of Object.entries(labels))
        if (typeof v !== 'string')
          throw TypeError(`label ${k} is not a string`);
      /** @type {IngressKey} */
      const key = `kernel:${kernel}:${next('ingress')}`;
      // the row first: a crash between the two leaves a row no request can
      // reach, not a mount whose requests find no ingress
      db.insert('kingress', { key, handler: null });
      try {
        await directory.mount(key, harden({ ...labels }));
      } catch (err) {
        db.lookup('kingress', { key }).delete();
        throw err;
      }
      return kernelObject(key);
    },
    /**
     * The kref that serves the ingress `key`, if any.
     *
     * @param {IngressKey} key
     * @returns {Kref | undefined}
     */
    handlerOf: key =>
      db.lookup('kingress', { key }).get()?.handler ?? undefined,
  });
