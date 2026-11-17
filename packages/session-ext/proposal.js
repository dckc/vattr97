/**
 * @file powerless: no chrome.*, no fetch, no clock. What a proposal says,
 * what to read for it, what to send, and how to say what happened without
 * saying a cookie's value or a key. The edges (popup.js, options.js) hold
 * the authority and pass in what's needed. See vattr97#67.
 *
 * A proposal is a link from a toybox app (toybox's
 * examples/session-keeper.js makes one): the app's session endpoint, then
 * a fragment naming the door's key, the site to read cookies from, the
 * cookies, and a label.
 *
 *     http://127.0.0.1:8788/api/session#key=...&site=https%3A%2F%2Fwww.example%2F&label=Example&cookie=sid
 */

/**
 * @typedef {object} Proposal
 * @property {string} endpoint where to send the session (the link without its fragment)
 * @property {string} key the door's key: whoever holds it can set the session
 * @property {string} site the URL whose cookies to read
 * @property {string[]} cookies their names
 * @property {string} label how to name the site
 */

/** A cookie name: an HTTP token. */
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
/** A door's key: a swiss number. */
const KEY = /^[0-9A-Za-z_-]{16,128}$/;
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * `text` as a URL, if it's https, or http on loopback; errors name `part`.
 *
 * @param {string} text
 * @param {string} part
 */
const secureURL = (text, part) => {
  let url;
  try {
    url = new URL(text);
  } catch {
    throw Error(`${part}: not a URL`);
  }
  const ok =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && LOOPBACK.includes(url.hostname));
  if (!ok) throw Error(`${part}: https, or http on loopback`);
  if (url.username || url.password)
    throw Error(`${part}: no credentials in it`);
  return url;
};

/**
 * The proposal a pasted link makes. Errors name parts, never the key.
 *
 * @param {string} text
 * @returns {Proposal}
 */
export const parseProposal = text => {
  const link = secureURL(text.trim(), 'link');
  const params = new URLSearchParams(link.hash.slice(1));
  link.hash = '';
  const key = params.get('key') ?? '';
  if (!KEY.test(key)) throw Error('key: missing or malformed');
  const site = secureURL(params.get('site') ?? '', 'site');
  site.hash = '';
  const label = params.get('label') ?? '';
  if (!/^[^\n]{1,64}$/.test(label))
    throw Error('label: one line, 64 characters at most');
  const cookies = params.getAll('cookie');
  if (cookies.length === 0) throw Error('cookie: name one at least');
  for (const name of cookies)
    if (!COOKIE_NAME.test(name))
      throw Error('cookie: each must be a cookie name');
  if (new Set(cookies).size !== cookies.length)
    throw Error('cookie: a name is repeated');
  return { endpoint: link.href, key, site: site.href, cookies, label };
};

/** One proposal per app endpoint and site: a new one replaces it. @param {Proposal} p */
export const proposalId = p => `${p.endpoint} ${p.site}`;

/**
 * The host permissions a proposal needs: to read the site's cookies, and
 * to post to the app's endpoint. A pattern names a host, not a port.
 *
 * @param {Proposal} p
 */
export const originsOf = p => [
  ...new Set(
    [p.site, p.endpoint].map(u => {
      const { protocol, hostname } = new URL(u);
      return `${protocol}//${hostname}/*`;
    }),
  ),
];

/**
 * What to show before Accept, line by line: what will be read, where it
 * goes, and how it differs from what was accepted for the same site.
 *
 * @param {Proposal} p
 * @param {Proposal[]} accepted
 */
export const review = (p, accepted) => {
  const lines = [
    `${p.label}: after you log in, read the cookie${p.cookies.length > 1 ? 's' : ''} ${p.cookies.join(', ')} for ${p.site}`,
    `and send ${p.cookies.length > 1 ? 'them' : 'it'} to ${p.endpoint}`,
  ];
  const was = accepted.find(a => proposalId(a) === proposalId(p));
  if (was) {
    const added = p.cookies.filter(c => !was.cookies.includes(c));
    lines.push(
      added.length
        ? `replaces the accepted proposal, and adds ${added.join(', ')}`
        : 'replaces the accepted proposal',
    );
  }
  return lines;
};

/**
 * `accepted`, with `p` in place of any proposal for the same endpoint and
 * site.
 *
 * @param {Proposal[]} accepted
 * @param {Proposal} p
 */
export const withProposal = (accepted, p) => [
  ...accepted.filter(a => proposalId(a) !== proposalId(p)),
  p,
];

/**
 * The host permissions to give up when `dropped` goes: those no
 * remaining proposal needs.
 *
 * @param {Proposal} dropped
 * @param {Proposal[]} remaining
 */
export const originsFreed = (dropped, remaining) => {
  const kept = new Set(remaining.flatMap(originsOf));
  return originsOf(dropped).filter(o => !kept.has(o));
};

/**
 * The cookies for `p`, by name, from chrome.cookies.getAll results for
 * each of its names; only those, and only with a value.
 *
 * @param {Proposal} p
 * @param {{ name: string, value: string }[]} found
 * @returns {Record<string, string>}
 */
export const cookiesFor = (p, found) => {
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of p.cookies) {
    const value = found.find(c => c.name === name)?.value;
    if (value) out[name] = value;
  }
  return out;
};

/**
 * Why not to send, if so: a cookie is missing, so there's no session.
 *
 * @param {Proposal} p
 * @param {Record<string, string>} cookies
 * @returns {string | undefined}
 */
export const refusal = (p, cookies) => {
  const missing = p.cookies.filter(name => !(name in cookies));
  if (missing.length === 0) return undefined;
  return `no ${missing.join(', ')} cookie: log in to ${p.label} first`;
};

/**
 * The POST that hands the app the session.
 *
 * @param {Proposal} p
 * @param {Record<string, string>} cookies
 * @param {string} at now, ISO 8601: a vat has no clock
 */
export const setRequest = (p, cookies, at) => ({
  url: p.endpoint,
  init: {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: p.key, op: 'set', cookies, at }),
  },
});

/**
 * The POST that closes the door, at the app's end.
 *
 * @param {Proposal} p
 */
export const revokeRequest = p => ({
  url: p.endpoint,
  init: {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: p.key, op: 'revoke' }),
  },
});

/**
 * A one-line report of what the app answered.
 *
 * @param {Proposal} p
 * @param {number} status
 * @param {{ ok?: boolean, summary?: string, stored?: boolean, error?: string }} body
 */
export const report = (p, status, body) => {
  if (body.ok) return body.summary ?? `${p.label}: done`;
  const why = body.error ?? 'no reason given';
  return body.stored
    ? `${p.label}: sent the session, but then: ${why}`
    : `${p.label}: failed (HTTP ${status}): ${why}`;
};
