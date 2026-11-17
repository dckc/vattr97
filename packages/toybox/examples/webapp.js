/**
 * A WebApp maker: a WebApp is an attenuated handle to one URL. Chain to
 * narrow (`pathjoin`, `query`, `withHeaders`, `withHeaderMap`,
 * `withFormMap`), then fire (`get`, `post`, `postForm`) through the
 * `egress` this vat was made with.
 *
 * Unions are flower-style: a shared key with a different value throws, so a
 * later grant cannot quietly contradict an earlier one. Error messages name
 * keys, never header or query values; a failed send's error quotes the
 * start of what the site answered, so it says why.
 *
 * Headers that change, such as a session cookie, belong in a map store
 * that someone else keeps (see store-maker.js): give a WebApp the store's
 * `readOnly()` facet, and the keeper rotates the cookie under handles
 * already given out. A form map is the same for a form field: a site that
 * wants the session echoed in the body (a double-submit check) gets it at
 * send, from a store the WebApp's holder can't read.
 */

const { entries, fromEntries } = Object;

/**
 * @import { BuildRootObject, Remote } from '../src/types.js';
 * @import { FetchAnswer } from '../src/devices/types.js';
 * @import { FetchDevice } from '../src/types.js';
 */

/**
 * A WebApp's state: its URL, its fixed headers, the maps it reads more
 * headers from at each send, and the maps it reads form fields from.
 * (`forms` is newer than the others: a WebApp made before it has none.)
 *
 * @typedef {{ url: string, headers: Record<string, string>, maps: EntriesMap[], forms?: EntriesMap[] }} WebAppState
 */

/**
 * Something with `entries()`, read at each send: a map store's
 * `readOnly()` facet, here or in another vat.
 *
 * @typedef {Remote<{ entries(): [string, unknown][] }>} EntriesMap
 */

/**
 * A handle to one URL. Declared, not inferred: its methods answer
 * WebApps, a cycle inference can't follow; the kind's methods are checked
 * against it.
 *
 * @typedef {object} WebApp
 * @property {(ref: string) => WebApp} pathjoin
 * @property {(params: Record<string, string | number>) => WebApp} query
 * @property {(more: Record<string, string>) => WebApp} withHeaders
 * @property {(map: EntriesMap) => WebApp} withHeaderMap
 * @property {(map: EntriesMap) => WebApp} withFormMap
 * @property {() => Promise<string>} get
 * @property {(body: string) => Promise<string>} post
 * @property {(fields: Record<string, string>) => Promise<string>} postForm
 */

/** @typedef {ReturnType<typeof buildRootObject>} WebAppMaker this vat's root */

/** @satisfies {BuildRootObject<{ egress: Remote<FetchDevice> }>} */
export const buildRootObject = ({ E, Far, M, zone }, { egress }) => {
  const Headers = M.recordOf(M.string(), M.string());
  // a page of a site's answer passes a pattern's default limit (100,000)
  const Body = M.string(harden({ stringLengthLimit: BODY_LIMIT }));
  const WebAppI = M.interface('WebApp', {
    pathjoin: M.call(M.string()).returns(M.remotable('WebApp')),
    query: M.call(M.recordOf(M.string(), M.or(M.string(), M.number()))).returns(
      M.remotable('WebApp'),
    ),
    withHeaders: M.call(Headers).returns(M.remotable('WebApp')),
    withHeaderMap: M.call(M.remotable()).returns(M.remotable('WebApp')),
    withFormMap: M.call(M.remotable()).returns(M.remotable('WebApp')),
    get: M.callWhen().returns(Body),
    post: M.callWhen(Body).returns(Body),
    postForm: M.callWhen(M.recordOf(M.string(), Body)).returns(Body),
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

  /** @type {(url: string, headers: Record<string, string>, maps: EntriesMap[], forms: EntriesMap[]) => WebApp} */
  const makeWebApp = zone.exoClass(
    'WebApp',
    WebAppI,
    /** @param {string} url @param {Record<string, string>} headers @param {EntriesMap[]} maps @param {EntriesMap[]} forms @returns {WebAppState} */
    (url, headers, maps, forms) => ({ url, headers, maps, forms }),
    {
      /** Join a relative path, keeping the query. The new path must stay within the old one. @param {string} ref */
      pathjoin(ref) {
        const { url, headers, maps, forms = [] } = this.state;
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
          forms,
        );
      },
      /** @param {Record<string, string | number>} params */
      query(params) {
        const { url, headers, maps, forms = [] } = this.state;
        return makeWebApp(unionQuery(url, params), headers, maps, forms);
      },
      /** @param {Record<string, string>} more */
      withHeaders(more) {
        const { url, headers, maps, forms = [] } = this.state;
        return makeWebApp(url, unionHeaders(headers, more), maps, forms);
      },
      /**
       * Add headers read from `map` at each send: anything with `entries()`,
       * such as a map store's `readOnly()` facet, here or in another vat.
       * A contradiction surfaces at send.
       *
       * @param {EntriesMap} map
       */
      withHeaderMap(map) {
        const { url, headers, maps, forms = [] } = this.state;
        return makeWebApp(url, headers, [...maps, map], forms);
      },
      /**
       * Add form fields read from `map` at each `postForm`, as
       * `withHeaderMap` adds headers: so a holder can send a field it can't
       * read, such as a session token a site wants echoed in the body.
       *
       * @param {EntriesMap} map
       */
      withFormMap(map) {
        const { url, headers, maps, forms = [] } = this.state;
        return makeWebApp(url, headers, maps, [...forms, map]);
      },
      async get() {
        return send(this.state.url, 'GET', await headersNow(this.state));
      },
      /** @param {string} body */
      async post(body) {
        return send(this.state.url, 'POST', await headersNow(this.state), body);
      },
      /**
       * POST `fields`, and each form map's entries as of now, as
       * multipart/form-data. A field named twice must have one value.
       *
       * @param {Record<string, string>} fields
       */
      async postForm(fields) {
        const all = await fieldsNow(fields, this.state.forms ?? []);
        const headers = unionHeaders(await headersNow(this.state), {
          'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        });
        return send(this.state.url, 'POST', headers, multipart(all));
      },
    },
  );

  /** `fields`, unioned with each form map's entries as of now. @param {Record<string, string>} fields @param {EntriesMap[]} forms */
  const fieldsNow = async (fields, forms) => {
    let now = unionFields({}, fields);
    for (const map of forms)
      now = unionFields(now, strings(await E(map).entries(), 'form'));
    return now;
  };

  /** The fixed headers, unioned with each map's entries as of now. @param {WebAppState} state */
  const headersNow = async ({ headers, maps }) => {
    let now = headers;
    for (const map of maps)
      now = unionHeaders(now, strings(await E(map).entries(), 'headers'));
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
      return makeWebApp(u.href, harden({ ...headers }), harden([]), harden([]));
    },
  });
};

/**
 * A map's entries as a record of strings; an entry that isn't one is
 * refused, naming its key, never its value.
 *
 * @param {[string, unknown][]} pairs
 * @param {string} what for the error: `headers` or `form`
 * @returns {Record<string, string>}
 */
const strings = (pairs, what) => {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of pairs) {
    if (typeof value !== 'string')
      throw Error(`${what}: ${key} is not a string`);
    // defineProperty, not assignment: a key may be __proto__
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
};

/** The longest body a WebApp sends or answers, in characters: 32 MiB. */
const BODY_LIMIT = 32 * 1024 * 1024;

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

/**
 * `base` and `more` as one set of form fields; a name in both must have
 * one value. Names are compared as given: forms, unlike headers, are
 * case-sensitive.
 *
 * @param {Record<string, string>} base
 * @param {Record<string, string>} more
 */
const unionFields = (base, more) => {
  /** @type {Map<string, string>} */
  const merged = new Map(entries(base));
  for (const [name, value] of entries(more)) {
    if (merged.has(name) && merged.get(name) !== value)
      throw Error(`form: contradicts on ${name}`);
    merged.set(name, value);
  }
  return harden(fromEntries(merged));
};

/**
 * A multipart/form-data boundary. A vat has no randomness, so it's fixed;
 * a field that holds it is refused rather than sent garbled.
 */
const BOUNDARY = '----toybox-webapp-form-7c1e5d0a9b3f';

/**
 * `fields` as a multipart/form-data body, delimited by {@link BOUNDARY}.
 * Errors name fields, never values.
 *
 * @param {Record<string, string>} fields
 */
const multipart = fields => {
  const parts = entries(fields).map(([name, value]) => {
    if (/["\r\n]/.test(name))
      throw Error(`form: ${JSON.stringify(name)} is no field name`);
    if (name.includes(BOUNDARY) || value.includes(BOUNDARY))
      throw Error(`form: ${name} holds the boundary`);
    return `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  });
  return `${parts.join('')}--${BOUNDARY}--\r\n`;
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
