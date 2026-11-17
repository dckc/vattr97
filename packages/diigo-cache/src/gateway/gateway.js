/**
 * diigo-cache's gateway: serves the app socket. It holds the cache (to
 * refresh and fill it), the cache's public viewer, the diigo site's
 * `SessionSite` (to show its proposal and revoke it), the session
 * keeper's door, the ingress, and entropy for the owner's key. It has no
 * network, and can't read the session.
 *
 * Routes:
 * - `GET /`: the owner page, a static shell; `GET /page.js`, its script,
 *   which reads the owner key from the fragment (`/#owner=...`)
 * - `POST /api/owner` `{ key, op, at?, pages? }`, op one of `status`,
 *   `refresh`, `fill`, `proposal`, `revoke`
 * - `POST /api/session`: the session extension's; the keeper's door answers
 * - `GET /public/<user>`: shared bookmarks, filtered by the query
 *   (`?days=7`, `?in=2026-W41`, `?q=#tag`, ...; `format=json` for JSON)
 *
 * Errors say what failed, never a key or cookie.
 */
/**
 * @import { BuildRootObject, Entropy, HttpResponse, Ingress, MapStore, Remote } from '../../../toybox/src/types.js';
 * @import { SessionDoor, SessionSite } from '../../../toybox/examples/session-keeper.js';
 * @import { DiigoCache, DiigoViewer } from '../cache/cache.js';
 */
import { hashicon } from './hashicon.js';
import { publicPage } from './render.js';

/**
 * @typedef {object} Params
 * @property {Remote<Ingress>} ingress where the pages and API are served
 * @property {Remote<Entropy>} entropy draws the owner's key
 * @property {Remote<DiigoCache>} cache the cache vat's root
 * @property {Remote<DiigoViewer>} viewer the cache's public view
 * @property {Remote<SessionSite>} site the diigo site's admin facet
 * @property {Remote<SessionDoor>} door the session keeper's door
 */

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

/** @param {string} body */
const parse = body => {
  try {
    const value = JSON.parse(body);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

/** @typedef {ReturnType<typeof buildRootObject>} DiigoGateway the gateway's root */

/** @satisfies {BuildRootObject<Params>} */
export const buildRootObject = (
  { E, Far, zone },
  { ingress, entropy, cache, viewer, site, door },
) => {
  /** @type {MapStore<string, string>} the owner's swiss number */
  const keys = zone.mapStore('keys');
  const ownerKey = async () => {
    if (!keys.has('owner')) {
      const swiss = await E(entropy).swiss();
      if (!keys.has('owner')) keys.init('owner', swiss);
    }
    return keys.get('owner');
  };

  /**
   * @param {{ key?: unknown, op?: unknown, at?: unknown, pages?: unknown }} req
   *   the owner page's request, as JSON parsed it: not checked yet
   */
  const owner = async ({ key, op, at, pages }) => {
    if (typeof key !== 'string' || key !== (await ownerKey()))
      return json(403, { ok: false, error: 'not the owner key' });
    try {
      if (op === 'status')
        return json(200, {
          ok: true,
          cache: await E(cache).status(),
          session: await E(site).status(),
        });
      if (op === 'refresh' || op === 'fill') {
        if (typeof at !== 'string')
          return json(400, {
            ok: false,
            error: 'at: expected an ISO 8601 time',
          });
        if (op === 'refresh')
          return json(200, { ok: true, refreshed: await E(cache).refresh(at) });
        if (
          pages !== undefined &&
          !(
            Number.isInteger(pages) &&
            Number(pages) >= 1 &&
            Number(pages) <= 100
          )
        )
          return json(400, {
            ok: false,
            error: 'pages: expected a whole number from 1 to 100',
          });
        return json(200, {
          ok: true,
          filled: await E(cache).fill(
            at,
            /** @type {number | undefined} */ (pages),
          ),
        });
      }
      if (op === 'proposal')
        return json(200, { ok: true, fragment: await E(site).fragment() });
      if (op === 'revoke') {
        await E(site).revoke();
        return json(200, { ok: true });
      }
    } catch (err) {
      return json(502, { ok: false, error: said(err) });
    }
    return json(400, {
      ok: false,
      error: 'op: expected status, refresh, fill, proposal, or revoke',
    });
  };

  /** @param {string} user @param {Record<string, string>} labels */
  const shared = async (user, labels) => {
    const found = await E(viewer).query(labels);
    if (!found.user || found.user !== user)
      return harden({
        status: 404,
        headers: { 'content-type': 'text/plain' },
        body: `no shared bookmarks for ${user}\n`,
      });
    const status = 'error' in found ? 400 : 200;
    if (labels.format === 'json') return json(status, found);
    return harden({
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: publicPage(user, labels, found),
    });
  };

  const makeHandler = zone.exoClass(
    'DiigoGatewayHandler',
    undefined,
    () => ({}),
    {
      /** @param {{ method: string, path: string, labels: Record<string, string>, body: string }} request */
      async handle({ method, path, labels, body }) {
        if (method === 'GET' && path === '/')
          return harden({
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            body: PAGE,
          });
        // a file of its own: the app socket's policy refuses inline scripts
        if (method === 'GET' && path === '/page.js')
          return harden({
            status: 200,
            headers: {
              'content-type': 'text/javascript; charset=utf-8',
              'cache-control': 'no-store',
            },
            body: SCRIPT,
          });
        if (method === 'POST' && path === '/api/owner')
          return owner(parse(body));
        if (method === 'POST' && path === '/api/session')
          return E(door).serve(body);
        const pub = /^\/public\/([A-Za-z0-9_-]{1,64})$/.exec(path);
        if (method === 'GET' && pub) return shared(pub[1], labels);
        return json(404, { ok: false, error: `no ${method} ${path}` });
      },
    },
  );
  zone.makeOnce('served', () => {
    const handler = makeHandler();
    E(ingress).serve(handler);
    return handler;
  });

  return Far('diigoGateway', {
    /** The owner page's fragment: whoever opens it can refresh the cache and hand out its proposal. */
    provideOwnerLink: async () => `#owner=${await ownerKey()}`,
  });
};

/** The owner page: a static shell, no third-party resources (they could read the fragment). */
const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>diigo-cache</title>
<style>
:root { color-scheme: light dark; --fg: #1d1d1f; --bg: #fff; --muted: #6e6e73; --bad: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --fg: #f5f5f7; --bg: #1c1c1e; --muted: #a1a1a6; --bad: #f2b8b5; } }
body { font: 15px/1.45 system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0 auto; padding: 16px; max-width: 760px; }
.muted { color: var(--muted); }
.failed { color: var(--bad); }
button { font: inherit; padding: 6px 12px; margin: 0 8px 8px 0; }
code { word-break: break-all; }
#icon svg { vertical-align: middle; margin-right: 8px; border-radius: 4px; }
#copy svg { vertical-align: middle; }
</style>
</head><body>
<h1>diigo-cache</h1>
<p id="status" class="muted">loading...</p>
<p id="session" class="muted"></p>
<p><button id="refresh">Refresh</button><button id="fill">Fill to the end</button></p>
<h2>Session</h2>
<p>The session extension (vattr97 <code>packages/session-ext</code>) hands this
cache your diigo session after you log in. Paste the proposal link into the
extension's Proposals page; it can set the session, not read the cache.</p>
<p><button id="proposal">Proposal link for the extension</button><button id="revoke">Revoke the session</button></p>
<p id="out" hidden><span id="icon"></span><button id="copy" title="Copy the proposal link" aria-label="Copy the proposal link"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg></button></p>
<p id="msg"></p>
<p><a id="public" hidden>Your shared bookmarks</a></p>
<script src="/page.js"></script>
</body></html>
`;

/**
 * The owner page's script: reads the key from the fragment, and asks
 * /api/owner. Beside a proposal link, the hashicon of its key, as the
 * extension draws it (hashicon.js, embedded as source).
 */
const SCRIPT = `const hashicon = ${hashicon};
const keyIcon = async k => hashicon(document, new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(k))));
const key = new URLSearchParams(location.hash.slice(1)).get('owner');
const $ = id => document.getElementById(id);
const say = (text, failed) => { $('msg').textContent = text; $('msg').className = failed ? 'failed' : 'muted'; };
const call = async (op, more = {}) => {
  const res = await fetch('/api/owner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, op, ...more }) });
  const body = await res.json();
  if (!body.ok) throw Error(body.error);
  return body;
};
const counts = r => r.added + ' new, ' + r.changed + ' changed';
const show = ({ cache: c, session: s }) => {
  const walk = c.walk.done ? 'every page stored' : 'stored to page ' + (c.walk.nextPage - 1) + ' of ' + (c.walk.pages ?? '?');
  $('status').textContent = c.shared + ' shared and ' + c.private + ' private bookmarks of ' + (c.total ?? '?') + '; ' + walk + (c.at ? '; last fetched ' + new Date(c.at).toLocaleString() : '');
  $('session').textContent = s.open ? (s.at ? 'session set ' + new Date(s.at).toLocaleString() : 'proposal out; no session yet') : 'no proposal out';
  if (c.user) { $('public').href = '/public/' + encodeURIComponent(c.user); $('public').hidden = false; }
};
const load = () => call('status').then(show, err => { $('status').textContent = err.message; });
if (!key) $('status').textContent = 'no owner key in this link';
else load();
$('refresh').onclick = () => call('refresh', { at: new Date().toISOString() }).then(b => { say('refreshed ' + b.refreshed.pages + ' pages: ' + counts(b.refreshed)); load(); }, err => say(err.message, true));
// a vat has no timer, so this page paces the fill: a step of 20 pages, a pause, the next, until every page is stored or Stop
let filling = false;
$('fill').onclick = async () => {
  if (filling) { filling = false; return; }
  filling = true;
  $('fill').textContent = 'Stop';
  try {
    while (filling) {
      const f = (await call('fill', { at: new Date().toISOString() })).filled;
      say((f.done ? 'filled every page: ' : 'filled to page ' + (f.nextPage - 1) + ' of ' + f.pages + ': ') + counts(f) + (f.done || !filling ? '' : '; filling on…'));
      load();
      if (f.done) break;
      await new Promise(resume => setTimeout(resume, 1000));
    }
  } catch (err) {
    say(err.message, true);
  } finally {
    filling = false;
    $('fill').textContent = 'Fill to the end';
  }
};
// the proposal link holds the door's key: copied, never shown, so no one reads it over your shoulder
let link = '';
const copy = () => navigator.clipboard.writeText(link).then(() => say('copied: paste it into the extension; the robot there should match this one'), err => say('copy failed: ' + err.message, true));
$('copy').onclick = copy;
$('proposal').onclick = () => call('proposal').then(async b => { link = location.origin + '/api/session' + b.fragment; $('icon').replaceChildren(await keyIcon(new URLSearchParams(b.fragment.slice(1)).get('key'))); $('out').hidden = false; copy(); load(); }, err => say(err.message, true));
$('revoke').onclick = () => call('revoke').then(() => { link = ''; $('out').hidden = true; $('icon').replaceChildren(); say('revoked: the proposal out no longer works, and the session is cleared'); load(); }, err => say(err.message, true));
`;
