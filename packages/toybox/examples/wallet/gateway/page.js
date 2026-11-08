/**
 * The wallet page, and its script. The page keeps its hub's swiss number
 * in localStorage: a link's fragment (`#hub=...`, or `#invite=...`) is read
 * once and taken out of the address bar.
 */

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>toybox wallet</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 1em auto; max-width: 52em; padding: 0 1em; }
  h1 { font-size: 1.3em; } h2 { font-size: 1.1em; margin-top: 1.5em; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border-bottom: 1px solid #ddd; padding: .3em; text-align: left; vertical-align: top; }
  input { font: inherit; } input.args { width: 12em; }
  pre { background: #f4f4f4; padding: .5em; white-space: pre-wrap; }
  .err { color: #a00; }
</style>
</head>
<body>
<h1>toybox wallet <small id="label"></small></h1>
<p id="status">loading…</p>
<section id="hub" hidden>
<h2>Names</h2>
<p>Call a method on what a name refers to. Arguments are JSON; <code>{"@name": "x"}</code> is the reference named x. An answer's references are saved as the name you give.</p>
<table><thead><tr><th>name</th><th>what</th><th>call</th></tr></thead><tbody id="names"></tbody></table>
<pre id="answer"></pre>
<h2>Messages</h2>
<table><thead><tr><th>#</th><th>from</th><th>label</th><th>refs</th><th></th></tr></thead><tbody id="messages"></tbody></table>
<h2>Send</h2>
<form id="send">to <input name="to" size="8"> label <input name="label" size="10"> names <input name="names" placeholder="a, b"> <button>send</button></form>
<h2>Invite</h2>
<form id="invite">someone to call <input name="peer" size="10"> <button>make a link</button></form>
<pre id="link"></pre>
</section>
<script src="/wallet.js"></script>
</body>
</html>
`;

export const SCRIPT = `'use strict';
const $ = id => document.getElementById(id);
const el = (tag, props, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const store = {
  get: () => localStorage.getItem('hub'),
  set: swiss => localStorage.setItem('hub', swiss),
};
const api = async req => {
  const resp = await fetch('/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hub: store.get() ?? undefined, ...req }),
  });
  const data = await resp.json();
  if (!resp.ok) throw Error(data.error);
  return data;
};
const show = (where, text, bad) => {
  $(where).textContent = text;
  $(where).className = bad ? 'err' : '';
};
const guard = (where, f) => async (...args) => {
  try {
    await f(...args);
  } catch (e) {
    show(where, String(e.message), true);
  }
};

// polling redraws only the messages, so it doesn't wipe a call being typed
const render = async ({ withNames = true } = {}) => {
  const { label, names, messages } = await api({ op: 'view' });
  $('label').textContent = label;
  if (withNames) $('names').replaceChildren(
    ...names.map(({ name, iface }) => {
      const method = el('input', { size: 10, placeholder: 'method' });
      const args = el('input', { className: 'args', placeholder: '[]' });
      const saveAs = el('input', { size: 8, placeholder: 'save as' });
      const call = el('button', { textContent: 'call' });
      call.onclick = guard('answer', async () => {
        const { answer } = await api({
          op: 'call',
          target: name,
          method: method.value,
          args: JSON.parse(args.value || '[]'),
          saveAs: saveAs.value || undefined,
        });
        show('answer', name + '.' + method.value + ' → ' + JSON.stringify(answer));
        await render();
      });
      return el('tr', {}, el('td', { textContent: name }), el('td', { textContent: iface }),
        el('td', {}, method, ' ', args, ' ', saveAs, ' ', call));
    }),
  );
  $('messages').replaceChildren(
    ...messages.map(({ id, from, label: what, count }) => {
      const index = el('input', { size: 2, value: '0' });
      const as = el('input', { size: 8, placeholder: 'name it' });
      const adopt = el('button', { textContent: 'adopt' });
      adopt.onclick = guard('answer', async () => {
        await api({ op: 'adopt', id, index: Number(index.value), name: as.value });
        await render();
      });
      const dismiss = el('button', { textContent: 'dismiss' });
      dismiss.onclick = guard('answer', async () => {
        await api({ op: 'dismiss', id });
        await render();
      });
      return el('tr', {}, el('td', { textContent: String(id) }), el('td', { textContent: from }),
        el('td', { textContent: what }), el('td', { textContent: String(count) }),
        el('td', {}, index, ' ', as, ' ', adopt, ' ', dismiss));
    }),
  );
};

$('send').onsubmit = guard('answer', async ev => {
  ev.preventDefault();
  const f = ev.target.elements;
  const names = f.names.value.split(',').map(s => s.trim()).filter(Boolean);
  await api({ op: 'send', to: f.to.value, label: f.label.value, names });
  show('answer', 'sent');
});
$('invite').onsubmit = guard('link', async ev => {
  ev.preventDefault();
  const { invite } = await api({ op: 'invite', peer: ev.target.elements.peer.value });
  show('link', location.origin + '/#invite=' + invite + '  (one use)');
});

const start = async () => {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (location.hash) history.replaceState(null, '', location.pathname);
  if (fragment.get('hub')) store.set(fragment.get('hub'));
  const invite = fragment.get('invite');
  if (invite) {
    const { hub, inviter } = await api({ op: 'accept', invite });
    if (hub) store.set(hub);
    show('answer', 'you now know them as ' + inviter);
  }
  if (!store.get()) {
    show('status', 'No hub here yet: open your invitation link.');
    return;
  }
  $('hub').hidden = false;
  show('status', '');
  setInterval(guard('status', () => render({ withNames: false })), 5000);
  await render();
};
guard('status', start)();
`;
