/**
 * A vat that skips liveslots and calls its syscall directly, naming vrefs
 * it was never given.
 */
import { env as workerEnv } from 'cloudflare:workers';

/** @import { BuildRootObject, CapData, Send } from '../types.js' */

// a vat's facet env, which the kernel gives it (kvat-runtime.js's VatEnv), not the supervisor's
const env = /** @type {{ syscall: { send: Send } }} */ (
  /** @type {unknown} */ (workerEnv)
);

const noArgs = { body: '#[]', slots: [] };

/** @type {BuildRootObject} */
export const buildRootObject = ({ Far }) => {
  /** @type {unknown} kept, so the kernel counts it held */
  let held;
  /** @param {string} vref @param {string} method @param {CapData} capdata */
  const attempt = async (vref, method, capdata) => {
    try {
      const { body } = await env.syscall.send(vref, method, capdata);
      return `reached: ${body}`;
    } catch (e) {
      return `refused: ${/** @type {Error} */ (e).message}`;
    }
  };
  return Far('forgerRoot', {
    /** @param {unknown} x */
    hold: x => void (held = x),
    /** Send `method` to `vref`, with no arguments. @param {string} vref @param {string} method */
    target: (vref, method) => attempt(vref, method, noArgs),
    /** Send `method` to `vref`, passing `slot` as its one argument. @param {string} vref @param {string} method @param {string} slot */
    slot: (vref, method, slot) =>
      attempt(vref, method, { body: '#["$0.Alleged: x"]', slots: [slot] }),
  });
};
