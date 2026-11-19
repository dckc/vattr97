/** @file Sub-zones: a zone's names, kept apart under a label. */

/** @import { Methods, State, Zone } from '../types.js' */

/**
 * A zone's makers, each given the key it stores by apart from the name it
 * shows: a kind's tag, which its objects are alleged to be, or a store's
 * name, which errors call it.
 *
 * @typedef {object} BaseZone
 * @property {(key: string, tag: string, guard: unknown, init: (...args: any[]) => State, methods: Methods) => (...args: any[]) => any} exoClass
 * @property {(key: string, tag: string, guards: Record<string, unknown> | undefined, init: (...args: any[]) => State, facets: Record<string, Methods>) => (...args: any[]) => any} exoClassKit
 * @property {(key: string, tag: string, guard: unknown, methods: Methods) => any} exo
 * @property {(key: string, make: () => any) => any} makeOnce
 * @property {(key: string, name: string) => any} mapStore
 * @property {Zone['detached']} detached
 */

/**
 * `base`, as a zone with sub-zones. `subZone(label)` is a zone whose
 * `makeOnce` keys, store names, and kind tags are stored under `label/`; a
 * label has no '/' of its own, so one sub-zone can't name what another
 * made, nor define a kind by another's key and give its objects other
 * methods. A kind's objects are alleged to be its tag alone, and a store's
 * errors give its name alone. The root's keys are its names, unchanged.
 *
 * @param {BaseZone} base
 * @returns {Zone}
 */
export const withSubZones = base => {
  /**
   * @param {string} path '', or labels each followed by '/'
   * @returns {Zone}
   */
  const at = path => {
    /**
     * `f`, given a name: stored under `path`, shown as given.
     *
     * @param {(key: string, name: string, ...rest: any[]) => any} f
     */
    const under = f =>
      /** @type {any} each Zone maker's type, which differs from the base maker's only by the key */ (
        (/** @type {string} */ name, /** @type {any[]} */ ...rest) =>
          f(`${path}${name}`, name, ...rest)
      );
    // The base makers are typed as generally as any kind's; Zone (types.ts)
    // types each in terms of the kind it makes.
    return harden({
      exoClass: under(base.exoClass),
      exoClassKit: under(base.exoClassKit),
      exo: under(base.exo),
      /** @type {Zone['makeOnce']} */
      makeOnce: (key, make) => base.makeOnce(`${path}${key}`, make),
      mapStore: under(base.mapStore),
      detached: base.detached,
      /** @param {string} label */
      subZone: label => {
        if (!label || label.includes('/'))
          throw TypeError(`a sub-zone's label must be non-empty, without '/'`);
        return at(`${path}${label}/`);
      },
    });
  };
  return at('');
};
