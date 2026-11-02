/**
 * A WebApp maker: a WebApp is an attenuated handle to one URL. Chain to
 * narrow (`pathjoin`, `query`, `withHeaders`, `withHeaderMap`), then fire
 * (`get`, `post`) through the `egress` this vat was made with.
 *
 * Unions are flower-style: a shared key with a different value throws, so a
 * later grant cannot quietly contradict an earlier one. Error messages name
 * keys, never header or query values.
 *
 * Headers that change, such as a session cookie, belong in a map store
 * that someone else keeps (see store-maker.js): give a WebApp the store's
 * `readOnly()` facet, and the keeper rotates the cookie under handles
 * already given out.
 */

const { entries, fromEntries } = Object;

/** @import { BuildRootObject, FetchAnswer, Remote } from '../types.js' */

/** A WebApp's state: its URL, its fixed headers, and the maps it reads more from at each send. @typedef {{ url: string, headers: Record<string, string>, maps: Remote[] }} WebAppState */

/** @type {BuildRootObject<{ egress: Remote }>} */
export const buildRootObject = ({ E, Far, zone }, { egress }) => {
  /** @param {string} url @param {string} method @param {Record<string, string>} headers @param {string} [body] */
  const send = async (url, method, headers, body) => {
    /** @type {FetchAnswer} */
    const { status, body: text } = await E(egress).fetch(url, {
      method,
      headers,
      body,
    });
    if (status >= 400) throw Error(`${status} on ${withoutQuery(url)}`);
    return text;
  };

  /** @type {(url: string, headers: Record<string, string>, maps: Remote[]) => object} */
  const makeWebApp = zone.exoClass(
    'WebApp',
    undefined,
    /** @param {string} url @param {Record<string, string>} headers @param {Remote[]} maps @returns {WebAppState} */
    (url, headers, maps) => ({ url, headers, maps }),
    {
      /** Join a relative path, keeping the query. The new path must stay within the old one. @param {string} ref */
      pathjoin(ref) {
        const { url, headers, maps } = this.state;
        const here = new URL(url);
        const there = new URL(ref, here);
        if (!withoutQuery(there.href).startsWith(withoutQuery(here.href))) {
          throw Error(
            `pathjoin: ${there.pathname} not within ${here.pathname}`,
          );
        }
        return makeWebApp(
          unionQuery(there.href, fromEntries(here.searchParams)),
          headers,
          maps,
        );
      },
      /** @param {Record<string, string | number>} params */
      query(params) {
        const { url, headers, maps } = this.state;
        return makeWebApp(unionQuery(url, params), headers, maps);
      },
      /** @param {Record<string, string>} more */
      withHeaders(more) {
        const { url, headers, maps } = this.state;
        return makeWebApp(url, unionHeaders(headers, more), maps);
      },
      /**
       * Add headers read from `map` at each send: anything with `entries()`,
       * such as a map store's `readOnly()` facet, here or in another vat.
       * A contradiction surfaces at send.
       *
       * @param {Remote} map
       */
      withHeaderMap(map) {
        const { url, headers, maps } = this.state;
        return makeWebApp(url, headers, [...maps, map]);
      },
      async get() {
        return send(this.state.url, 'GET', await headersNow(this.state));
      },
      /** @param {string} body */
      async post(body) {
        return send(this.state.url, 'POST', await headersNow(this.state), body);
      },
    },
  );

  /** The fixed headers, unioned with each map's entries as of now. @param {WebAppState} state */
  const headersNow = async ({ headers, maps }) => {
    let now = headers;
    for (const map of maps) {
      const pairs = await E(map).entries();
      for (const [key, value] of pairs) {
        if (typeof value !== 'string')
          throw Error(`headers: ${key} is not a string`);
      }
      now = unionHeaders(now, fromEntries(pairs));
    }
    return now;
  };

  return Far('webAppMaker', {
    /**
     * @param {string} url
     * @param {Record<string, string>} [headers]
     */
    makeWebApp: (url, headers = {}) =>
      makeWebApp(new URL(url).href, harden({ ...headers }), harden([])),
  });
};

/** @param {string} url */
const withoutQuery = url => {
  const u = new URL(url);
  u.search = '';
  return u.href;
};

/** @param {Record<string, string>} base @param {Record<string, string>} more */
const unionHeaders = (base, more) => {
  const merged = { ...base };
  for (const [key, value] of entries(more)) {
    if (key in merged && merged[key] !== value)
      throw Error(`headers: contradicts on ${key}`);
    merged[key] = value;
  }
  return harden(merged);
};

/** @param {string} base @param {Record<string, string | number>} params */
const unionQuery = (base, params) => {
  const there = new URL(base);
  for (const [key, value] of entries(params)) {
    const v = `${value}`;
    if (there.searchParams.has(key) && there.searchParams.get(key) !== v)
      throw Error(`query: contradicts on ${key}`);
    there.searchParams.set(key, v);
  }
  return there.href;
};
