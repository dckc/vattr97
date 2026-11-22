/**
 * The wallet page, and its script. The page keeps its agent's swiss number
 * in localStorage: a link's fragment (`#agent=...`, or `#invite=...`) is
 * read once and taken out of the address bar.
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
  input, textarea { font: inherit; } input.args { width: 12em; }
  textarea { width: 100%; font-family: monospace; }
  pre { background: #f4f4f4; padding: .5em; white-space: pre-wrap; }
  .err { color: #a00; }
</style>
</head>
<body>
<h1>toybox wallet <small id="label"></small></h1>
<p><a href="/blocks">blocks</a></p>
<p id="status">loading…</p>
<section id="agent" hidden>
<h2>Names</h2>
<p>Call a method on what a name refers to. Arguments are JSON; <code>{"@name": "x"}</code> is the reference named x. An answer's references are saved as the name you give.</p>
<p>A secret, such as a key to put in a store, goes here, never in the arguments: <input type="password" id="secretIn" size="24" autocomplete="off" aria-label="a secret"> and <code>{"@secret": true}</code> in the arguments stands for it. It's sent with the next call that names it, then cleared.</p>
<table><thead><tr><th>name</th><th>what</th><th>call</th></tr></thead><tbody id="names"></tbody></table>
<pre id="answer"></pre>
<p id="saveOut" hidden><button id="save">save answer as a file</button> <span id="saveName"></span></p>
<h2>Messages</h2>
<table><thead><tr><th>#</th><th>from</th><th>message</th><th></th></tr></thead><tbody id="messages"></tbody></table>
<h2>Send</h2>
<p>A message to a correspondent: text, and the things you name, which they see by the same names.</p>
<form id="send">to <input name="to" size="8"> text <input name="text" size="16"> names <input name="names" placeholder="a, b"> <button>send</button></form>
<div id="guestOnly" hidden>
<h2>Define</h2>
<p>Propose a vat to your host: its module, <code>main.js</code>, and its params, the slots, each with a label saying what it's for. Your host reads the source, and decides what fills each slot, if anything.</p>
<form id="define">slots <input name="slots" class="args" placeholder='{"site": {"label": "..."}}'>
<textarea name="source" rows="8" placeholder="export const buildRootObject = (powers, params) => ..."></textarea>
<button>propose</button></form>
</div>
<div id="hostOnly" hidden>
<h2>Invite</h2>
<p>A peer, another host, who you'll each know by name.</p>
<form id="invite">someone to call <input name="peer" size="10"> <button>make a link</button></form>
<h2>Guest</h2>
<p>A guest of yours: it starts knowing only you, and proposes to you what it needs.</p>
<form id="guest">guest's name <input name="name" size="10"> <button>make a link</button></form>
<p>A page: what a name refers to answers <code>handle(request)</code> at a link of its own, in a sandbox.</p>
<form id="servePage">name to serve <input name="name" size="10"> <button>make a link</button></form>
</div>
<p id="linkOut" hidden><input type="password" id="secret" readonly size="40" aria-label="the link, hidden"> <button id="copy">copy</button></p>
<p id="link"></p>
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
  get: () => localStorage.getItem('agent'),
  set: swiss => localStorage.setItem('agent', swiss),
};
const api = async req => {
  const resp = await fetch('/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: store.get() ?? undefined, ...req }),
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

// {"@secret": true}, anywhere in a call's arguments, is the secret field's text,
// so a key goes to a store without being shown
const withSecret = v => {
  if (Array.isArray(v)) return v.map(withSecret);
  if (v && typeof v === 'object') {
    const ks = Object.keys(v);
    if (ks.length === 1 && ks[0] === '@secret' && v['@secret'] === true) {
      if (!$('secretIn').value) throw Error('the secret field is empty');
      return $('secretIn').value;
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withSecret(x)]));
  }
  return v;
};

// an answer that's text, such as a CSV or OFX download, can be saved as a
// file, named for the call: a method ending in Csv or Ofx gets that extension
let saveUrl = '';
const offerSave = (answer, base) => {
  if (saveUrl) URL.revokeObjectURL(saveUrl);
  $('saveOut').hidden = typeof answer !== 'string';
  if (typeof answer !== 'string') return;
  const ext = (base.match(/(csv|ofx)$/i)?.[1] ?? 'txt').toLowerCase();
  saveUrl = URL.createObjectURL(new Blob([answer], { type: 'text/plain' }));
  $('saveName').textContent = base + '.' + ext;
  $('save').onclick = () =>
    Object.assign(document.createElement('a'), { href: saveUrl, download: base + '.' + ext }).click();
};

// polling redraws only the messages, and only when they changed, so it
// doesn't wipe a call or an endowment being typed
let shownMessages = '';
const render = async ({ withNames = true } = {}) => {
  const { label, kind, names, messages } = await api({ op: 'view' });
  const seen = JSON.stringify(messages);
  const messagesChanged = seen !== shownMessages;
  shownMessages = seen;
  $('label').textContent = label + ' (' + kind + ')';
  $('hostOnly').hidden = kind !== 'host';
  $('guestOnly').hidden = kind !== 'guest';
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
          args: withSecret(JSON.parse(args.value || '[]')),
          saveAs: saveAs.value || undefined,
        });
        $('secretIn').value = '';
        show('answer', name + '.' + method.value + ' → ' + (typeof answer === 'string'
          ? 'text, ' + answer.length + ' characters; save it as a file. It begins:\\n' + answer.split('\\n').slice(0, 5).join('\\n')
          : JSON.stringify(answer)));
        offerSave(answer, name + '-' + method.value);
        await render();
      });
      // forgetting a name drops this host's hold on it; anyone else's stays
      const forget = el('button', { textContent: 'delete', title: 'forget the name ' + name });
      forget.onclick = guard('answer', async () => {
        if (!confirm('Forget the name ' + name + '?')) return;
        await api({ op: 'forget', name });
        show('answer', 'forgot ' + name);
        await render();
      });
      return el('tr', {}, el('td', { textContent: name }), el('td', { textContent: iface }),
        el('td', {}, method, ' ', args, ' ', saveAs, ' ', call, ' ', forget));
    }),
  );
  if (withNames || messagesChanged) $('messages').replaceChildren(
    ...messages.map(message => {
      const { number, from } = message;
      if (message.type === 'definition') return definitionRow(message);
      const { strings, names: edgeNames } = message;
      const text = strings.flatMap((s, i) => i < edgeNames.length ? [s, el('code', { textContent: '@' + edgeNames[i] })] : [s]);
      const edge = el('input', { size: 8, value: edgeNames[0] ?? '' });
      const as = el('input', { size: 8, placeholder: 'name it' });
      const adopt = el('button', { textContent: 'adopt' });
      adopt.onclick = guard('answer', async () => {
        await api({ op: 'adopt', number, edgeName: edge.value, petName: as.value });
        await render();
      });
      return el('tr', {}, el('td', { textContent: String(number) }), el('td', { textContent: from ?? '?' }),
        el('td', {}, ...text), el('td', {}, edge, ' ', as, ' ', adopt, ' ', dismissButton(number)));
    }),
  );
};

const dismissButton = number => {
  const dismiss = el('button', { textContent: 'dismiss' });
  dismiss.onclick = guard('answer', async () => {
    await api({ op: 'dismiss', number });
    await render();
  });
  return dismiss;
};

// a proposed module: its slots and source to read, open, since endowing runs it at once, and what to fill each slot with
const definitionRow = ({ number, from, modules, slots }) => {
  const bindings = el('input', { className: 'args', placeholder: JSON.stringify(Object.fromEntries(Object.keys(slots).map(k => [k, 'a name']))) });
  const as = el('input', { size: 8, placeholder: 'save as' });
  const endow = el('button', { textContent: 'endow' });
  endow.onclick = guard('answer', async () => {
    const { answer } = await api({ op: 'endow', number, bindings: JSON.parse(bindings.value || '{}'), saveAs: as.value });
    show('answer', 'endowed: ' + JSON.stringify(answer));
    await render();
  });
  const slotList = el('ul', {}, ...Object.entries(slots).map(([name, { label }]) => el('li', {}, el('code', { textContent: name }), ': ' + label)));
  return el('tr', {}, el('td', { textContent: String(number) }), el('td', { textContent: from ?? '?' }),
    el('td', {}, 'a definition', slotList, ...Object.entries(modules).map(([path, source]) =>
      el('details', { open: true }, el('summary', { textContent: path }), el('pre', { textContent: source })))),
    el('td', {}, bindings, ' ', as, ' ', endow, ' ', dismissButton(number)));
};

$('send').onsubmit = guard('answer', async ev => {
  ev.preventDefault();
  const f = ev.target.elements;
  const names = f.names.value.split(',').map(s => s.trim()).filter(Boolean);
  const strings = [f.text.value, ...names.slice(1).map(() => ' ')];
  await api({ op: 'send', to: f.to.value, strings, edgeNames: names, petNames: names });
  show('answer', 'sent');
});
$('define').onsubmit = guard('answer', async ev => {
  ev.preventDefault();
  const f = ev.target.elements;
  await api({ op: 'define', slots: JSON.parse(f.slots.value || '{}'), modules: { 'main.js': f.source.value } });
  show('answer', 'proposed');
});
// a link holds a secret: it goes in a password field, to copy, never shown
// (a password field won't copy with Ctrl-C, hence the button)
const holdLink = (link, note) => {
  $('secret').value = link;
  $('linkOut').hidden = false;
  show('link', 'made a link (' + note + '); copy it, and keep it to yourself');
};
$('copy').onclick = guard('link', () =>
  navigator.clipboard.writeText($('secret').value).then(() => show('link', 'copied')));
$('invite').onsubmit = guard('link', async ev => {
  ev.preventDefault();
  const { invite } = await api({ op: 'invite', peer: ev.target.elements.peer.value });
  holdLink(location.origin + '/#invite=' + invite, 'one use');
});
$('servePage').onsubmit = guard('link', async ev => {
  ev.preventDefault();
  const { page } = await api({ op: 'servePage', name: ev.target.elements.name.value });
  holdLink(location.origin + '/page#page=' + page, 'whoever holds it can use that page');
});
$('guest').onsubmit = guard('link', async ev => {
  ev.preventDefault();
  const { guest } = await api({ op: 'provideGuest', name: ev.target.elements.name.value });
  holdLink(location.origin + '/#agent=' + guest, 'whoever holds it is your guest');
  await render();
});

const start = async () => {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (location.hash) history.replaceState(null, '', location.pathname);
  if (fragment.get('agent')) store.set(fragment.get('agent'));
  const invite = fragment.get('invite');
  if (invite) {
    const { host, inviter } = await api({ op: 'accept', invite });
    if (host) store.set(host);
    show('answer', 'you now know them as ' + inviter);
  }
  if (!store.get()) {
    show('status', 'No one here yet: open your link.');
    return;
  }
  $('agent').hidden = false;
  show('status', '');
  setInterval(guard('status', () => render({ withNames: false })), 5000);
  await render();
};
guard('status', start)();
`;
