/**
 * @file A zone in the heap: the kinds and stores of a vat's durable zone
 * (liveslots.js), whose objects are gone with the heap. For testing a
 * kind's behavior without a vatstore.
 */
import { defineExoClass, defineExoClassKit } from '@endo/exo';
import { Far } from '@endo/pass-style';
import { withSubZones } from './sub-zones.js';

/** @import { Key, MapStore, Methods, State, Zone } from '../types.js' */

/**
 * A map store, and its read-only facet, as remotables, so either can be
 * passed, kept in an object's state, or used as a key.
 *
 * @template {Key} K
 * @template V
 * @param {string} label
 * @returns {MapStore<K, V>}
 */
const makeStore = label => {
  /** @type {Map<K, V>} */
  const map = new Map();
  /** @param {K} key */
  const get = key => {
    if (!map.has(key)) throw Error(`no such key in ${label}`);
    return /** @type {V} has(key) */ (map.get(key));
  };
  const queries = {
    /** @param {K} key */
    has: key => map.has(key),
    get,
    keys: () => harden([...map.keys()]),
    values: () => harden([...map.values()]),
    entries: () => harden([...map.entries()]),
    getSize: () => map.size,
  };
  const readOnly = Far('ReadonlyMapStore', queries);
  return Far('MapStore', {
    ...queries,
    /** @param {K} key @param {V} value */
    init: (key, value) => {
      if (map.has(key)) throw Error(`key already in ${label}`);
      map.set(key, value);
    },
    /** @param {K} key @param {V} value */
    set: (key, value) => {
      get(key);
      map.set(key, value);
    },
    /** @param {K} key */
    delete: key => {
      get(key);
      map.delete(key);
    },
    readOnly: () => readOnly,
  });
};

/**
 * A zone whose objects live in the heap: `exoClass`, `exo`, and
 * `exoClassKit` make @endo/exo objects with the same defaults as a vat's
 * durable zone (a kind given no guard gets @endo/exo's, which checks that
 * arguments and results are passable), and stores are maps.
 * Nothing outlasts the heap, so a test of a kind's durability still needs
 * liveslots.
 *
 * @returns {Zone}
 */
export const makeHeapZone = () => {
  /** @type {Map<string, unknown>} */
  const once = new Map();

  /**
   * @template T
   * @param {string} key
   * @param {() => T} make
   * @returns {T}
   */
  const makeOnce = (key, make) => {
    if (!once.has(key)) once.set(key, make());
    return /** @type {T} made above, or in an earlier call */ (once.get(key));
  };

  /**
   * @param {string} _key
   * @param {string} tag
   * @param {unknown} interfaceGuard
   * @param {(...args: any[]) => State} init
   * @param {Methods} methods
   */
  const exoClass = (_key, tag, interfaceGuard, init, methods) =>
    defineExoClass(
      tag,
      /** @type {any} a guard is any of M.interface's */ (interfaceGuard),
      init,
      methods,
    );

  return withSubZones(
    harden({
      exoClass,
      /**
       * @param {string} key
       * @param {string} tag
       * @param {unknown} interfaceGuard
       * @param {Methods} methods
       */
      exo: (key, tag, interfaceGuard, methods) =>
        makeOnce(`exo.${key}`, () =>
          exoClass(key, tag, interfaceGuard, () => ({}), methods)(),
        ),
      /**
       * @param {string} _key
       * @param {string} tag
       * @param {Record<string, unknown> | undefined} interfaceGuards
       * @param {(...args: any[]) => State} init
       * @param {Record<string, Methods>} facets
       */
      exoClassKit: (_key, tag, interfaceGuards, init, facets) =>
        defineExoClassKit(
          tag,
          /** @type {any} guards, as above */ (interfaceGuards),
          init,
          /** @type {any} @endo/exo types a kit's methods by its context, which these can't name */ (
            facets
          ),
        ),
      makeOnce,
      /** @param {string} key @param {string} name */
      mapStore: (key, name) => makeOnce(`store.${key}`, () => makeStore(name)),
      /** @type {Zone['detached']} */
      detached: () =>
        harden({
          /** @param {string} label */
          mapStore: label => makeStore(label),
        }),
    }),
  );
};
