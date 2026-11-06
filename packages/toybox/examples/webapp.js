/**
 * A WebApp maker: a WebApp is an attenuated handle to one URL. Chain to
 * narrow (`pathjoin`, `query`, `withHeaders`, `withHeaderMap`), then fire
 * (`get`, `post`) through the `egress` this vat was made with.
 *
 * Unions are flower-style: a shared key with a different value throws, so a
 * later grant cannot quietly contradict an earlier one. Error messages name
 * keys, never header or query values; a failed send's error quotes the
 * start of what the site answered, so it says why.
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
export const buildRootObject = ({ E, Far, M, zone }, { egress }) => {
  const Headers = M.recordOf(M.string(), M.string());
  const WebAppI = M.interface('WebApp', {
    pathjoin: M.call(M.string()).returns(M.remotable('WebApp')),
    query: M.call(M.recordOf(M.string(), M.or(M.string(), M.number()))).returns(
      M.remotable('WebApp'),
    ),
    withHeaders: M.call(Headers).returns(M.remotable('WebApp')),
    withHeaderMap: M.call(M.remotable()).returns(M.remotable('WebApp')),
    get: M.callWhen().returns(M.string()),
    post: M.callWhen(M.string()).returns(M.string()),
  });

  /** @param {string} url @param {string} method @param {Record<string, string>} headers @param {string} [body] */
  const send = async (url, method, headers, body) => {
    /** @type {FetchAnswer} */
    const { status, body: text } = await E(egress).fetch(url, {
      method,
      headers,
      body,
    });
    if (status >= 400)
      throw Error(`${status} on ${shown(url)}: ${excerpt(text)}`);
    return text;
  };

  /** @type {(url: string, headers: Record<string, string>, maps: Remote[]) => object} */
  const makeWebApp = zone.exoClass(
    'WebApp',
    WebAppI,
    /** @param {string} url @param {Record<string, string>} headers @param {Remote[]} maps @returns {WebAppState} */
    (url, headers, maps) => ({ url, headers, maps }),
    {
      /** Join a relative path, keeping the query. The new path must stay within the old one. @param {string} ref */
      pathjoin(ref) {
        const { url, headers, maps } = this.state;
        const here = new URL(url);
        const there = new URL(ref, here);
        if (!within(there, here)) {
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
    makeWebApp: (url, headers = {}) => {
      if (
        typeof url !== 'string' ||
        typeof headers !== 'object' ||
        !Object.values(headers).every(v => typeof v === 'string')
      )
        throw Error('makeWebApp: takes a URL and a record of header strings');
      const u = new URL(url);
      // fetch refuses such a URL, and its error would quote them
      if (u.username || u.password)
        throw Error(
          'makeWebApp: a URL has no credentials; send them as a header',
        );
      return makeWebApp(u.href, harden({ ...headers }), harden([]));
    },
  });
};

/** How much of an error response's body an error says. */
const EXCERPT = 200;

/**
 * The start of an error response's body, on one line: what the site said
 * went wrong. Not the query, which may hold a secret.
 *
 * @param {string} body
 */
const excerpt = body => {
  const line = body.replace(/\s+/g, ' ').trim();
  return line.length > EXCERPT ? `${line.slice(0, EXCERPT)}…` : line;
};

/**
 * Is `there` at or under `here`: the same origin and credentials, and a
 * path that is `here`'s or goes on from it by whole segments? (`/api/v1`
 * holds `/api/v1/x`, not `/api/v1-admin`.)
 *
 * @param {URL} there
 * @param {URL} here
 */
const within = (there, here) => {
  if (
    there.origin !== here.origin ||
    there.username !== here.username ||
    there.password !== here.password
  )
    return false;
  const dir = here.pathname.endsWith('/') ? here.pathname : `${here.pathname}/`;
  return there.pathname === here.pathname || there.pathname.startsWith(dir);
};

/** `url` as an error may show it: no query or fragment. @param {string} url */
const shown = url => {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.href;
};

/**
 * `base` and `more` as one set of headers, their names in lower case, as
 * HTTP compares them; a name in both must have one value.
 *
 * @param {Record<string, string>} base
 * @param {Record<string, string>} more
 */
const unionHeaders = (base, more) => {
  /** @type {Map<string, string>} */
  const merged = new Map();
  for (const [key, value] of [...entries(base), ...entries(more)]) {
    const name = key.toLowerCase();
    if (merged.has(name) && merged.get(name) !== value)
      throw Error(`headers: contradicts on ${name}`);
    merged.set(name, value);
  }
  return harden(fromEntries(merged));
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
