import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cookiesFor,
  originsFreed,
  originsOf,
  parseProposal,
  proposalId,
  refusal,
  report,
  review,
  revokeRequest,
  setRequest,
  withProposal,
} from './proposal.js';

const KEY = '0123456789abcdef0123456789abcdef';
const link = (
  fragment = `key=${KEY}&site=https%3A%2F%2Fwww.example%2F&label=Example&cookie=sid&cookie=csrf`,
) => `http://127.0.0.1:8788/api/session#${fragment}`;

const p = parseProposal(` ${link()}\n`);

test('a proposal link names the endpoint, key, site, cookies, and label', () => {
  assert.deepEqual(p, {
    endpoint: 'http://127.0.0.1:8788/api/session',
    key: KEY,
    site: 'https://www.example/',
    cookies: ['sid', 'csrf'],
    label: 'Example',
  });
});

test('refuses a link it cannot use, naming parts but not the key', () => {
  const bad = [
    ['{', /^Error: link: not a URL$/],
    [
      `http://evil.example/api#key=${KEY}`,
      /^Error: link: https, or http on loopback$/,
    ],
    [
      link('site=https%3A%2F%2Fwww.example%2F&label=E&cookie=sid'),
      /^Error: key: missing or malformed$/,
    ],
    [
      link(`key=${KEY}&site=http%3A%2F%2Fwww.example%2F&label=E&cookie=sid`),
      /^Error: site: https, or http on loopback$/,
    ],
    [
      link(`key=${KEY}&site=https%3A%2F%2Fwww.example%2F&label=E`),
      /^Error: cookie: name one at least$/,
    ],
    [
      link(`key=${KEY}&site=https%3A%2F%2Fwww.example%2F&label=E&cookie=a%3Bb`),
      /^Error: cookie: each must be a cookie name$/,
    ],
    [
      link(
        `key=${KEY}&site=https%3A%2F%2Fwww.example%2F&label=E&cookie=a&cookie=a`,
      ),
      /^Error: cookie: a name is repeated$/,
    ],
    [
      link(`key=${KEY}&site=https%3A%2F%2Fwww.example%2F&cookie=a`),
      /^Error: label:/,
    ],
  ];
  for (const [text, why] of bad) {
    assert.throws(
      () => parseProposal(/** @type {string} */ (text)),
      /** @type {RegExp} */ (why),
    );
    try {
      parseProposal(/** @type {string} */ (text));
    } catch (err) {
      assert.doesNotMatch(String(err), new RegExp(KEY));
    }
  }
});

test('asks for the site and the app, by host', () => {
  assert.deepEqual(originsOf(p), ['https://*.example/*', 'http://127.0.0.1/*']);
});

test("the site's permission covers cookies set for its parent domain", () => {
  // diigo sets `_smasher_session` with domain=diigo.com, for www.diigo.com;
  // chrome.cookies answers a cookie only with permission for its domain
  const at = (/** @type {string} */ site) => originsOf({ ...p, site })[0];
  assert.equal(at('https://www.diigo.com/'), 'https://*.diigo.com/*');
  assert.equal(at('https://diigo.com/'), 'https://*.diigo.com/*');
  assert.equal(
    at('https://online.bank.example/'),
    'https://*.online.bank.example/*',
  );
  assert.equal(at('http://localhost:8788/'), 'http://localhost/*');
  assert.equal(at('http://127.0.0.1:8788/'), 'http://127.0.0.1/*');
});

test('the review says what is read and where it goes, and what a replacement adds', () => {
  assert.deepEqual(review(p, []), [
    'Example: after you log in, read the cookies sid, csrf for https://www.example/',
    'and send them to http://127.0.0.1:8788/api/session',
  ]);
  const one = { ...p, cookies: ['sid'] };
  assert.deepEqual(
    review(p, [one]).at(-1),
    'replaces the accepted proposal, and adds csrf',
  );
  assert.deepEqual(review(one, [p]).at(-1), 'replaces the accepted proposal');
});

test('one proposal per endpoint and site; dropping one frees only the hosts no other needs', () => {
  const other = { ...p, site: 'https://other.example/', key: 'k'.repeat(32) };
  const both = withProposal(withProposal([], p), other);
  assert.deepEqual(both.map(proposalId), [proposalId(p), proposalId(other)]);
  const again = withProposal(both, { ...p, key: 'n'.repeat(32) });
  assert.equal(again.length, 2);
  assert.equal(again.at(-1)?.key, 'n'.repeat(32));
  assert.deepEqual(originsFreed(p, [other]), ['https://*.example/*']);
  assert.deepEqual(originsFreed(p, []), [
    'https://*.example/*',
    'http://127.0.0.1/*',
  ]);
});

test('reads only the cookies named, and refuses to send without each', () => {
  const found = [
    { name: 'sid', value: 's1' },
    { name: 'tracking', value: 't' },
    { name: 'csrf', value: '' },
  ];
  const got = cookiesFor(p, found);
  assert.deepEqual(got, { sid: 's1' });
  assert.equal(refusal(p, got), 'no csrf cookie: log in to Example first');
  assert.equal(refusal(p, { sid: 's', csrf: 'c' }), undefined);
});

test('the hand-off is a POST of key, cookies, and time; dropping posts a revoke', () => {
  assert.deepEqual(
    setRequest(p, { sid: 's', csrf: 'c' }, '2026-11-17T15:00:00.000Z'),
    {
      url: 'http://127.0.0.1:8788/api/session',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: KEY,
          op: 'set',
          cookies: { sid: 's', csrf: 'c' },
          at: '2026-11-17T15:00:00.000Z',
        }),
      },
    },
  );
  assert.equal(JSON.parse(revokeRequest(p).init.body).op, 'revoke');
});

test("reports the app's summary, or why it failed", () => {
  assert.equal(
    report(p, 200, { ok: true, summary: 'Example session stored; 3 new' }),
    'Example session stored; 3 new',
  );
  assert.equal(
    report(p, 502, { ok: false, stored: true, error: '403 on x' }),
    'Example: sent the session, but then: 403 on x',
  );
  assert.equal(
    report(p, 403, { ok: false, error: 'not an open session key' }),
    'Example: failed (HTTP 403): not an open session key',
  );
});
