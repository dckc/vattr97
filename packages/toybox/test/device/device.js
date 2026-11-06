/**
 * A device vat for tests: it holds the `files` binding, and hands out
 * readers of one file each. The test rewrites `VERSION` to upgrade it.
 */
/** @import { BuildRootObject } from '../../src/types.js' */

const VERSION = 'v1';

/** @type {BuildRootObject<{}>} */
export const buildRootObject = ({ Far, zone, endowment }) => {
  const makeReader = zone.exoClass(
    'Reader',
    undefined,
    /** @param {string} path */ path => ({ path }),
    {
      async read() {
        const { path } = this.state;
        const resp = await endowment('files').fetch(
          `http://files/${encodeURIComponent(path)}`,
        );
        if (!resp.ok) throw Error(`${path}: ${resp.status}`);
        return resp.text();
      },
    },
  );
  return Far('device', {
    /** @param {string} path */
    reader: path => makeReader(path),
    version: () => VERSION,
  });
};
