/**
 * @file Ingresses: a mount reserved in the Directory at some labels, which
 * the ingress's `serve(handler)` routes to. The kernel keeps the handler's
 * kref, so a request after any restart starts its vat if need be.
 */
import { M } from '@endo/patterns';
import { kernelObjects } from './objects.js';

/** @import { KernelPowers } from '../types.js' */

export const SCHEMA = [
  // an ingress (a kernel object; its key is its vref) and the kref of whoever serves it
  'CREATE TABLE IF NOT EXISTS kingress (key TEXT PRIMARY KEY, handler TEXT)',
];

/**
 * @param {KernelPowers} powers
 * @param {object} io
 * @param {string} io.kernel this kernel's id, which an ingress's key names, so the Directory's mount leads back here
 * @param {{ mount: (key: string, labels: Record<string, string>) => Promise<void> }} io.directory
 */
export const makeIngresses = (
  { sql, next, kernelObject, krefOf },
  { kernel, directory },
) =>
  harden({
    ...kernelObjects(
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
          sql.exec(
            'UPDATE kingress SET handler = ? WHERE key = ?',
            kref,
            `kernel:${this.state.rest}`,
          );
        },
      },
    ),
    /**
     * Reserve a mount at `labels`; answers the ingress for it.
     *
     * @param {Record<string, string>} labels
     */
    async make(labels) {
      const key = `kernel:${kernel}:${next('ingress')}`;
      // the row first: a crash between the two leaves a row no request can
      // reach, not a mount whose requests find no ingress
      sql.exec('INSERT INTO kingress VALUES (?, NULL)', key);
      try {
        await directory.mount(key, harden({ ...labels }));
      } catch (err) {
        sql.exec('DELETE FROM kingress WHERE key = ?', key);
        throw err;
      }
      return kernelObject(key);
    },
    /**
     * The ingress for the socket `name`, which no Directory mount leads to:
     * the socket's entrypoint goes to this kernel directly.
     *
     * @param {string} name
     */
    socket(name) {
      const key = this.socketKey(name);
      sql.exec('INSERT OR IGNORE INTO kingress VALUES (?, NULL)', key);
      return kernelObject(key);
    },
    /** The key of the socket `name`'s ingress. @param {string} name */
    socketKey: name => `kernel:${kernel}:${name}`,
    /**
     * The kref that serves the ingress `key`, if any.
     *
     * @param {string} key
     * @returns {string | undefined}
     */
    handlerOf(key) {
      const [row] = sql
        .exec('SELECT handler FROM kingress WHERE key = ?', key)
        .toArray();
      return (
        /** @type {string | null | undefined} TEXT, or NULL */ (row?.handler) ??
        undefined
      );
    },
  });
