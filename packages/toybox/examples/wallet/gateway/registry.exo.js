/**
 * @file A durable registry of swiss numbers, each designating an object,
 * after E's SwissTable. The wallet's gateway keeps its agents in one;
 * another vat may copy this module among its own. See
 * {@link prepareRegistry}.
 */

/** @import { MapStore, Powers, Remote, SwissNum, Zone } from '@vattr/toybox/src/types.js' */

/**
 * Whether `x` could be a swiss number: 22 base64url characters, as an
 * entropy device answers them. A page sends one as JSON, which says only
 * that it's a string.
 *
 * @param {unknown} x
 * @returns {x is SwissNum}
 */
export const isSwissNum = x =>
  typeof x === 'string' && /^[A-Za-z0-9_-]{22}$/.test(x);

/**
 * A registry: `register(x)` answers a swiss number for `x`, the same one
 * each time; `deref(swiss)` answers what a swiss number designates.
 *
 * @template {object} T what it designates
 * @typedef {object} Registry
 * @property {(x: T) => Promise<SwissNum>} register
 * @property {(swiss: unknown) => T | undefined} deref `undefined` for anything else, a string that isn't a swiss number included
 */

/**
 * Define the kind of durable registry, in `zone`, and answer its maker.
 * Whoever holds a swiss number holds what it designates, so the number
 * goes only in a link's fragment or a request's body, never in a log.
 *
 * @template {object} T what it designates: durable objects, or ones from another vat, which a registry can keep
 * @param {Zone} zone
 * @param {Pick<Powers, 'E' | 'M'> & { entropy: Remote<{ swiss(): SwissNum }> }} powers
 * @returns {() => Registry<T>}
 * @see https://waterken.sourceforge.net/web-key/ Waterken's web-keys, which put swiss numbers in links
 */
export const prepareRegistry = (zone, { E, M, entropy }) =>
  zone.exoClass(
    'Registry',
    M.interface('Registry', {
      register: M.call(M.remotable()).returns(M.promise()),
      deref: M.call(M.any()).returns(M.or(M.remotable(), M.undefined())),
    }),
    () => {
      const stores = zone.detached();
      /** @type {MapStore<SwissNum, T>} */
      const bySwiss = stores.mapStore('by swiss');
      /** @type {MapStore<T, SwissNum>} */
      const swissOf = stores.mapStore('swiss of');
      return { bySwiss, swissOf };
    },
    {
      /** @param {T} x */
      async register(x) {
        const { bySwiss, swissOf } = this.state;
        if (swissOf.has(x)) return swissOf.get(x);
        const swiss = await E(entropy).swiss();
        // another register(x) may have finished while this one waited
        if (swissOf.has(x)) return swissOf.get(x);
        bySwiss.init(swiss, x);
        swissOf.init(x, swiss);
        return swiss;
      },
      /** @param {unknown} swiss */
      deref(swiss) {
        const { bySwiss } = this.state;
        return isSwissNum(swiss) && bySwiss.has(swiss)
          ? bySwiss.get(swiss)
          : undefined;
      },
    },
  );
