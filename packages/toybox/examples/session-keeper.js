/**
 * The app end of a session handoff (vattr97#67): a WebApp's holder needs a
 * site's session, but not the password, and the session lives in the
 * browser. For each site, this vat keeps a door that can only write the
 * session into a store, and a proposal that names the door's key and what
 * to read: the site's URL and its cookie names. The session extension
 * (packages/session-ext) reads those cookies after a login and posts them
 * here; the store, read through WebApps' header or form maps, then sends
 * them on.
 *
 * Who holds what: the app's boot vat holds this vat's root, to add
 * sites; whoever runs the app's page holds a site's `SessionSite`, to
 * show its proposal, see when it was last set, or revoke it; the app's
 * gateway holds the `door()`, to hand `serve` the body of each `POST`
 * from the extension. This vat holds the stores' write facets, and
 * nothing that reads the network.
 *
 * Requests (JSON, from the extension): `{ key, op: 'set', cookies, at }`
 * writes the session and answers `{ ok, summary }`; `{ key, op: 'revoke' }`
 * ends the door. Answers name keys and counts, never cookie values.
 */
/** @import { BuildRootObject, Entropy, HttpResponse, MapStore, Remote } from '../src/types.js' */

/**
 * A store the session goes into: a map store, read-write (see
 * store-maker.js), as this vat uses it.
 *
 * @typedef {Pick<MapStore<string, string>, 'has' | 'init' | 'set' | 'delete'>} SessionStore
 */

/**
 * What the app does after each new session, such as refresh what the
 * session reads: its answer ends the summary the extension shows.
 *
 * @typedef {{ sessionSet(at: string): string | Promise<string> }} SessionHook
 */

/**
 * What a site's proposal asks the extension to read.
 *
 * @typedef {object} Descriptor
 * @property {string} site the URL whose cookies to read (https, or http on loopback)
 * @property {string[]} cookies their names
 * @property {string} label how the extension names the site
 */

/**
 * Where the cookies go in the store, by store key: a cookie name puts
 * that cookie's value there (as a session-token header or form field wants
 * it); a list of names puts `a=1; b=2` there (as a `cookie` header wants
 * it).
 *
 * @typedef {Record<string, string | string[]>} Layout
 */

/**
 * A site's state.
 *
 * @typedef {object} SiteState
 * @property {Descriptor} descriptor
 * @property {Layout} layout
 * @property {Remote<SessionStore>} store where the session goes
 * @property {Remote<SessionHook> | undefined} after told `sessionSet(at)` after each set
 * @property {string | undefined} key the door's swiss number, if it's open
 * @property {string | undefined} at when the session was last set, as the extension said
 */

/** A cookie name: an HTTP token. */
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
/** A cookie value, as a browser stores one: no space, `;`, `,`, `"`, or `\`. */
const COOKIE_VALUE = /^[^\s;,"\\]{1,4096}$/;
/** A time, ISO 8601 as `Date#toISOString()` makes it. */
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/;

/** @param {number} status @param {unknown} value @returns {HttpResponse} */
const json = (status, value) =>
  harden({
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(value),
  });

/** @param {unknown} err */
const said = err => String(err).replace(/^Error: /, '');

/**
 * Check a descriptor and layout: every cookie the layout uses is one the
 * descriptor names, and the reverse. Errors name the part at fault.
 *
 * @param {Descriptor} descriptor
 * @param {Layout} layout
 */
export const checkSite = ({ site, cookies, label }, layout) => {
  const url = new URL(site);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)))
    throw Error('site: https, or http on loopback');
  if (url.username || url.password || url.hash)
    throw Error('site: no credentials or fragment');
  if (typeof label !== 'string' || !/^[^\n]{1,64}$/.test(label))
    throw Error('label: one line, 64 characters at most');
  if (!Array.isArray(cookies) || cookies.length === 0)
    throw Error('cookies: name one at least');
  for (const name of cookies)
    if (typeof name !== 'string' || !COOKIE_NAME.test(name))
      throw Error('cookies: each a cookie name');
  const used = new Set(Object.values(layout).flat());
  for (const name of used)
    if (!cookies.includes(name))
      throw Error(`layout: ${name} is not among the cookies`);
  for (const name of cookies)
    if (!used.has(name)) throw Error(`layout: puts ${name} nowhere`);
};

/**
 * The store's entries for `cookies`, as `layout` places them.
 *
 * @param {Layout} layout
 * @param {Record<string, string>} cookies
 */
export const entriesFor = (layout, cookies) =>
  Object.entries(layout).map(([key, from]) => [
    key,
    typeof from === 'string'
      ? cookies[from]
      : from.map(name => `${name}=${cookies[name]}`).join('; '),
  ]);

/**
 * Why `cookies` won't do for `names`, if so: each named cookie, and no
 * other, with a value a browser could hold. Names the cookie at fault,
 * never its value.
 *
 * @param {string[]} names
 * @param {unknown} cookies
 * @returns {string | undefined}
 */
export const cookieRefusal = (names, cookies) => {
  if (!cookies || typeof cookies !== 'object' || Array.isArray(cookies))
    return 'cookies: expected a record of name to value';
  const given = Object.keys(cookies);
  for (const name of given)
    if (!names.includes(name)) return `cookies: ${name} was not asked for`;
  for (const name of names) {
    const value = /** @type {Record<string, unknown>} */ (cookies)[name];
    if (!Object.hasOwn(cookies, name)) return `cookies: ${name} is missing`;
    if (typeof value !== 'string' || !COOKIE_VALUE.test(value))
      return `cookies: ${name} is malformed`;
  }
  return undefined;
};

/**
 * A proposal's fragment: the door's key, and the descriptor. The
 * extension takes the link it ends (the endpoint, then this) as a
 * proposal; see packages/session-ext/proposal.js.
 *
 * @param {string} key
 * @param {Descriptor} descriptor
 */
export const proposalFragment = (key, { site, cookies, label }) => {
  const params = new URLSearchParams({ key, site, label });
  for (const name of cookies) params.append('cookie', name);
  return `#${params}`;
};

/**
 * @typedef {ReturnType<typeof buildRootObject>} SessionKeeper this vat's root, for the app's boot vat
 * @typedef {ReturnType<SessionKeeper['site']>} SessionSite a site's admin facet
 * @typedef {ReturnType<SessionKeeper['door']>} SessionDoor the door, for the app's gateway
 */

/** @satisfies {BuildRootObject<{ entropy: Remote<Entropy> }>} */
export const buildRootObject = ({ E, Far, M, zone }, { entropy }) => {
  /** @type {MapStore<string, SiteState>} each site, by name */
  const sites = zone.mapStore('sites');
  /** @type {MapStore<string, string>} each open door's site, by key */
  const doors = zone.mapStore('doors');
  /** @type {MapStore<string, ReturnType<typeof makeSite>>} each site's admin facet, by name */
  const admins = zone.mapStore('admins');

  /** @param {string} name @param {Partial<SiteState>} more */
  const update = (name, more) =>
    sites.set(name, harden({ ...sites.get(name), ...more }));

  /** Close `name`'s door, and clear the session from its store. @param {string} name */
  const revoke = async name => {
    const { key, layout, store } = sites.get(name);
    if (key !== undefined && doors.has(key)) doors.delete(key);
    update(name, { key: undefined, at: undefined });
    for (const k of Object.keys(layout))
      if (await E(store).has(k)) await E(store).delete(k);
  };

  const makeSite = zone.exoClass(
    'SessionSite',
    M.interface('SessionSite', {
      fragment: M.callWhen().returns(M.string()),
      status: M.call().returns(M.record()),
      revoke: M.callWhen().returns(M.undefined()),
    }),
    /** @param {string} name */
    name => ({ name }),
    {
      /**
       * The proposal's fragment, for the app's page to append to its
       * session endpoint's URL; opens a door if none is open. Whoever
       * holds the link can set the session; pass it only to the extension.
       */
      async fragment() {
        const { name } = this.state;
        const { key, descriptor } = sites.get(name);
        if (key !== undefined) return proposalFragment(key, descriptor);
        /** @type {string} */
        const drawn = await E(entropy).swiss();
        // another call may have opened one meanwhile
        const opened = sites.get(name).key;
        if (opened !== undefined) return proposalFragment(opened, descriptor);
        doors.init(drawn, name);
        update(name, { key: drawn });
        return proposalFragment(drawn, descriptor);
      },
      /** What the site is, whether its door is open, and when it was last set; no key or value. */
      status() {
        const { descriptor, key, at } = sites.get(this.state.name);
        return harden({
          ...descriptor,
          open: key !== undefined,
          ...(at ? { at } : {}),
        });
      },
      /** Close the door (a proposal already handed out stops working), and clear the session. */
      async revoke() {
        await revoke(this.state.name);
      },
    },
  );

  /**
   * @param {string} name
   * @param {{ cookies?: unknown, at?: unknown }} req as JSON parsed it: not checked yet
   */
  const set = async (name, { cookies, at }) => {
    const { descriptor, layout, store, after } = sites.get(name);
    const why = cookieRefusal(descriptor.cookies, cookies);
    if (why) return json(400, { ok: false, error: why });
    if (typeof at !== 'string' || !ISO_TIME.test(at))
      return json(400, { ok: false, error: 'at: expected an ISO 8601 time' });
    // cookieRefusal found each named cookie, and no other, a string
    const checked = /** @type {Record<string, string>} */ (cookies);
    for (const [k, v] of entriesFor(layout, checked)) {
      if (await E(store).has(k)) await E(store).set(k, v);
      else await E(store).init(k, v);
    }
    update(name, { at });
    const stored = `${descriptor.label} session stored`;
    if (!after) return json(200, { ok: true, summary: stored });
    try {
      const then = await E(after).sessionSet(at);
      return json(200, { ok: true, summary: `${stored}; ${then}` });
    } catch (err) {
      return json(502, { ok: false, stored: true, error: said(err) });
    }
  };

  /**
   * Answer a request from the extension, given its JSON body. The key is
   * the only credential; an unknown key learns nothing.
   *
   * @param {string} body
   */
  const serve = async body => {
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }
    /** @type {{ key?: unknown, op?: unknown, cookies?: unknown, at?: unknown } | undefined} */
    const req =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : undefined;
    if (!req || typeof req !== 'object')
      return json(400, { ok: false, error: 'expected a JSON object' });
    const { key, op = 'set' } = req;
    if (typeof key !== 'string' || !doors.has(key))
      return json(403, { ok: false, error: 'not an open session key' });
    const name = doors.get(key);
    if (op === 'set') return set(name, req);
    if (op === 'revoke') {
      await revoke(name);
      return json(200, {
        ok: true,
        summary: `${sites.get(name).descriptor.label}: revoked`,
      });
    }
    return json(400, { ok: false, error: 'op: expected set or revoke' });
  };

  const makeDoor = zone.exoClass(
    'SessionDoor',
    M.interface('SessionDoor', {
      serve: M.callWhen(M.string()).returns(M.record()),
    }),
    () => ({}),
    { serve },
  );
  const door = zone.makeOnce('door', () => makeDoor());

  return Far('sessionKeeper', {
    /**
     * The site `name`, made if need be; on later calls (a boot vat calls
     * on each start), its descriptor, layout, store, and `after` hook are
     * brought up to date. A changed descriptor closes the door, so the
     * extension is asked to review the new one.
     *
     * @param {string} name
     * @param {Descriptor} descriptor
     * @param {{ store: Remote<SessionStore>, layout: Layout, after?: Remote<SessionHook> }} into
     */
    site(name, descriptor, { store, layout, after }) {
      checkSite(descriptor, layout);
      const d = harden({
        site: new URL(descriptor.site).href,
        cookies: [...descriptor.cookies],
        label: descriptor.label,
      });
      const fixed = harden({ store, layout: harden({ ...layout }), after });
      if (!sites.has(name)) {
        sites.init(
          name,
          harden({ descriptor: d, ...fixed, key: undefined, at: undefined }),
        );
      } else {
        const was = sites.get(name).descriptor;
        const same =
          was.site === d.site &&
          was.label === d.label &&
          was.cookies.join(' ') === d.cookies.join(' ');
        update(name, { descriptor: d, ...fixed });
        if (!same) {
          const { key } = sites.get(name);
          if (key !== undefined && doors.has(key)) doors.delete(key);
          update(name, { key: undefined });
        }
      }
      if (!admins.has(name)) admins.init(name, makeSite(name));
      return admins.get(name);
    },
    /** The door the app's gateway hands each `POST` from the extension: `serve(body)` alone. */
    door: () => door,
  });
};
