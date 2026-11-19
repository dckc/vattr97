/**
 * @file NameHub and NameAdmin, the parts of Agoric's the wallet uses: an
 * agent's names, their reading and their writing facets.
 * @see https://github.com/Agoric/agoric-sdk/blob/master/packages/vats/src/nameHub.js `@agoric/vats`' nameHub.js, whose API and guards these follow
 */

/** @import { Powers, Remote, Zone, MapStore } from '../../../src/types.js' */

/**
 * The reading facet.
 *
 * @typedef {object} NameHub
 * @property {(key: string) => boolean} has
 * @property {(key: string) => Promise<Remote>} lookup what `key` names: anything, typed only by its use
 * @property {() => [string, unknown][]} entries
 * @property {() => string[]} keys
 */

/**
 * The writing facet.
 *
 * @typedef {object} NameAdmin
 * @property {(key: string, value: unknown) => void} update name `value` as `key`, in place of what it named, if anything
 * @property {(key: string) => void} delete
 */

/** @typedef {{ nameHub: NameHub, nameAdmin: NameAdmin }} NameHubKit */

/**
 * The NameHubKit kind, in `zone`: `makeNameHubKit()` makes a hub's names,
 * kept in `zone`.
 *
 * @param {Zone} zone
 * @param {Pick<Powers, 'M'>} powers
 */
export const prepareNameHubKit = (zone, { M }) => {
  const KeyShape = M.string();
  /** @type {() => NameHubKit} */
  const makeNameHubKit = zone.exoClassKit(
    'NameHubKit',
    {
      nameHub: M.interface('NameHub', {
        has: M.call(KeyShape).returns(M.boolean()),
        lookup: M.call(KeyShape).returns(M.promise()),
        entries: M.call().returns(M.array()),
        keys: M.call().returns(M.arrayOf(KeyShape)),
      }),
      nameAdmin: M.interface('NameAdmin', {
        update: M.call(KeyShape, M.any()).returns(),
        delete: M.call(KeyShape).returns(),
      }),
    },
    () => ({
      /** @type {MapStore<string, unknown>} */
      keyToValue: zone.detached().mapStore('nameKey'),
    }),
    {
      nameHub: {
        /** @param {string} key */
        has(key) {
          return this.state.keyToValue.has(key);
        },
        /** @param {string} key */
        async lookup(key) {
          const { keyToValue } = this.state;
          if (!keyToValue.has(key))
            throw Error(`"nameKey" not found: ${JSON.stringify(key)}`);
          return keyToValue.get(key);
        },
        entries() {
          return harden(this.state.keyToValue.entries());
        },
        keys() {
          return harden(this.state.keyToValue.keys());
        },
      },
      nameAdmin: {
        /** @param {string} key @param {unknown} value */
        update(key, value) {
          const { keyToValue } = this.state;
          if (keyToValue.has(key)) keyToValue.set(key, value);
          else keyToValue.init(key, value);
        },
        /** @param {string} key */
        delete(key) {
          this.state.keyToValue.delete(key);
        },
      },
    },
  );
  return makeNameHubKit;
};
