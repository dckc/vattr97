/**
 * @file the edge for proposals: holds chrome.permissions, chrome.storage,
 * and fetch (to tell an app its door is dropped); proposal.js decides what
 * each means. Keys are kept, never shown: a hashicon of each stands in,
 * to match against the one on the app's page.
 */
import { keyIcon } from './hashicon.js';
import {
  originsFreed,
  originsOf,
  parseProposal,
  proposalId,
  report,
  review,
  revokeRequest,
  withProposal,
} from './proposal.js';

/** @typedef {import('./proposal.js').Proposal} Proposal */

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));
const say = (/** @type {string} */ text, failed = false) => {
  $('msg').textContent = text;
  $('msg').className = failed ? 'failed' : 'muted';
};

/** @returns {Promise<Proposal[]>} */
const accepted = async () =>
  (await chrome.storage.local.get('proposals')).proposals ?? [];
const keep = (/** @type {Proposal[]} */ proposals) =>
  chrome.storage.local.set({ proposals });

/** the proposal under review, between Review and Accept */
/** @type {Proposal | undefined} */
let pending;

const show = async () => {
  const list = $('accepted');
  list.replaceChildren();
  const all = await accepted();
  if (all.length === 0)
    list.append(
      Object.assign(document.createElement('li'), {
        textContent: 'none yet',
        className: 'muted',
      }),
    );
  for (const p of all) {
    const li = document.createElement('li');
    const what = document.createElement('div');
    what.textContent = `${p.label}: ${p.cookies.join(', ')} from ${p.site}, to ${p.endpoint}`;
    what.prepend(await keyIcon(document, crypto.subtle, p.key));
    const drop = Object.assign(document.createElement('button'), {
      textContent: 'Drop',
    });
    drop.onclick = () => dropIt(p);
    li.append(what, drop);
    list.append(li);
  }
};

/** forget `p`, give up the hosts nothing else needs, and tell the app to close its door */
const dropIt = async (/** @type {Proposal} */ p) => {
  const remaining = (await accepted()).filter(
    a => proposalId(a) !== proposalId(p),
  );
  await keep(remaining);
  const freed = originsFreed(p, remaining);
  let told;
  try {
    const { url, init } = revokeRequest(p);
    const res = await fetch(url, init);
    told = report(
      p,
      res.status,
      await res.json().catch(() => ({ error: 'not JSON' })),
    );
  } catch (err) {
    told = `${p.label}: dropped here, but the app wasn't told (${err instanceof Error ? err.message : err}); revoke it on the app's page`;
  }
  if (freed.length) await chrome.permissions.remove({ origins: freed });
  say(told);
  await show();
};

$('review').onclick = async () => {
  const field = /** @type {HTMLInputElement} */ ($('link'));
  try {
    pending = parseProposal(field.value);
  } catch (err) {
    pending = undefined;
    $('proposed').hidden = true;
    say(err instanceof Error ? err.message : String(err), true);
    return;
  } finally {
    field.value = '';
  }
  const lines = $('lines');
  lines.replaceChildren(
    ...review(pending, await accepted()).map(textContent =>
      Object.assign(document.createElement('li'), { textContent }),
    ),
  );
  lines.prepend(await keyIcon(document, crypto.subtle, pending.key));
  $('proposed').hidden = false;
  say("the picture should match the one beside the link on the app's page");
};

$('cancel').onclick = () => {
  pending = undefined;
  $('proposed').hidden = true;
};

$('accept').onclick = () => {
  const p = pending;
  if (!p) return;
  // first thing in the click: the browser's prompt needs the user's gesture, and names the hosts
  chrome.permissions.request({ origins: originsOf(p) }).then(
    async granted => {
      if (!granted)
        return say('not accepted: the browser did not grant access', true);
      await keep(withProposal(await accepted(), p));
      pending = undefined;
      $('proposed').hidden = true;
      say(`accepted ${p.label}`);
      await show();
    },
    err => say(String(err.message ?? err), true),
  );
};

show();
