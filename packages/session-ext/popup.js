/**
 * @file the edge for sending: holds chrome.cookies, chrome.storage, fetch,
 * and the clock, narrows each to one use, and hands those to proposal.js.
 */
import { keyIcon } from './hashicon.js';
import { cookiesFor, refusal, report, setRequest } from './proposal.js';

/** @typedef {import('./proposal.js').Proposal} Proposal */

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));
const say = (/** @type {string} */ text, failed = false) => {
  $('msg').textContent = text;
  $('msg').className = failed ? 'failed' : '';
};

/** each cookie `p` names, as the browser would send it to `p.site`, and nothing else */
const readCookies = async (/** @type {Proposal} */ p) => {
  const found = (
    await Promise.all(
      p.cookies.map(name => chrome.cookies.getAll({ url: p.site, name })),
    )
  ).flat();
  return cookiesFor(p, found);
};

/** hand `p`'s app the session; it answers with a summary */
const send = async (
  /** @type {Proposal} */ p,
  /** @type {Record<string, string>} */ cookies,
) => {
  const { url, init } = setRequest(p, cookies, new Date().toISOString());
  const res = await fetch(url, init);
  return {
    status: res.status,
    body: await res.json().catch(() => ({ error: 'not JSON' })),
  };
};

const sendIt = async (/** @type {Proposal} */ p) => {
  try {
    const cookies = await readCookies(p);
    const why = refusal(p, cookies);
    if (why) return say(why, true);
    say(`sending ${p.label}…`);
    const { status, body } = await send(p, cookies);
    say(report(p, status, body), !body.ok);
  } catch (err) {
    // fetch errors name the URL at most, never the body
    say(
      `${p.label}: failed: ${err instanceof Error ? err.message : err} (is the app running?)`,
      true,
    );
  }
};

/** @type {Proposal[]} */
const proposals = (await chrome.storage.local.get('proposals')).proposals ?? [];
if (proposals.length === 0)
  say('no proposals yet: paste one in Proposals', true);
for (const p of proposals) {
  const li = document.createElement('li');
  const button = Object.assign(document.createElement('button'), {
    textContent: `Send ${p.label}`,
  });
  button.onclick = () => sendIt(p);
  li.append(await keyIcon(document, crypto.subtle, p.key), button);
  $('sites').append(li);
}
