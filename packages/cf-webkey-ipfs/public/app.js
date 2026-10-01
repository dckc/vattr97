import { newWebSocketRpcSession } from './vendor/capnweb.js';

const READ_BYTES = 1024 * 1024;
const PREVIEW_BYTES = 4096;
const TTL_CHOICES = [
  ['no expiry', undefined],
  ['1 minute', 60_000],
  ['1 hour', 3_600_000],
  ['1 day', 86_400_000],
];

/**
 * @param {string} tag
 * @param {Record<string, unknown>} [props]
 * @param {(Node | string)[]} [children]
 */
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const formatBytes = size =>
  size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KiB`;

const formatTime = ms => (ms ? new Date(ms).toLocaleString() : 'never');

/** The web-key URL for a secret: the secret rides in the fragment. */
const webkeyUrl = secret => `${location.origin}/#${secret}`;

/** A read-only field holding a web-key URL, with a copy button. */
const webkeyField = secret => {
  const input = el('input', { readOnly: true, value: webkeyUrl(secret) });
  const copy = el('button', { textContent: 'copy' });
  copy.addEventListener('click', () =>
    navigator.clipboard.writeText(input.value),
  );
  return el('div', {}, [input, copy]);
};

/** Read a whole file through its capability, a bounded piece at a time. */
const readAll = async file => {
  const { size } = await file.stat();
  const parts = [];
  for (let at = 0; at < size; at += READ_BYTES) {
    parts.push(await file.read(at, READ_BYTES));
  }
  return parts;
};

const download = async file => {
  const { name, type } = await file.stat();
  const url = URL.createObjectURL(new Blob(await readAll(file), { type }));
  el('a', { href: url, download: name }).click();
  URL.revokeObjectURL(url);
};

/**
 * Controls for sharing one file and for revoking the shares made here.
 *
 * @param {any} file a file capability
 */
const sharePanel = file => {
  const list = el('ul');
  const minted = el('div');
  const ttl = el(
    'select',
    {},
    TTL_CHOICES.map(([label], index) =>
      el('option', { value: String(index), textContent: label }),
    ),
  );
  const share = el('button', { textContent: 'share' });

  const refresh = async () => {
    const shares = await file.shares();
    list.replaceChildren(
      ...shares.map(({ shareId, expiresAt, revoked }) => {
        const revoke = el('button', {
          textContent: 'revoke',
          disabled: revoked,
        });
        revoke.addEventListener('click', async () => {
          await file.revoke(shareId);
          await refresh();
        });
        return el('li', { className: 'muted' }, [
          `share ${shareId.slice(0, 8)}… `,
          revoked ? 'revoked ' : `expires ${formatTime(expiresAt)} `,
          revoke,
        ]);
      }),
    );
  };

  share.addEventListener('click', async () => {
    const [, ttlMs] = TTL_CHOICES[Number(ttl.value)];
    const { webkey } = await file.share({ ttlMs });
    minted.replaceChildren(
      el('p', { className: 'note' }, [
        'Anyone with this link can read the file. It is shown once.',
      ]),
      webkeyField(webkey),
    );
    await refresh();
  });

  refresh();
  return el('div', {}, [share, ttl, minted, list]);
};

/**
 * @param {HTMLElement} root
 * @param {any} vault a vault capability
 */
const renderVault = async (root, vault) => {
  const list = el('ul');
  const picker = el('input', { type: 'file' });

  const refresh = async () => {
    const entries = await vault.list();
    list.replaceChildren(
      ...entries.map(({ name, size }) => {
        const file = vault.get(name);
        const get = el('button', { textContent: 'download' });
        get.addEventListener('click', () => download(file));
        const remove = el('button', { textContent: 'remove' });
        remove.addEventListener('click', async () => {
          await vault.remove(name);
          await refresh();
        });
        return el('li', {}, [
          el('strong', { textContent: name }),
          ` ${formatBytes(size)} `,
          get,
          remove,
          sharePanel(file),
        ]);
      }),
    );
  };

  picker.addEventListener('change', async () => {
    const [chosen] = picker.files;
    if (!chosen) return;
    const bytes = new Uint8Array(await chosen.arrayBuffer());
    await vault.put(chosen.name, bytes, chosen.type || undefined);
    picker.value = '';
    await refresh();
  });

  root.replaceChildren(
    el('p', { className: 'note' }, [
      'This page’s URL is the key to your vault. Bookmark it; it cannot be recovered.',
    ]),
    el('p', {}, ['Add a file: ', picker]),
    list,
  );
  await refresh();
};

/**
 * @param {HTMLElement} root
 * @param {any} file a file capability
 */
const renderFile = async (root, file) => {
  const { name, type, size } = await file.stat();
  const get = el('button', { textContent: 'download' });
  get.addEventListener('click', () => download(file));
  const preview = el('pre');
  if (type.startsWith('text/')) {
    const head = await file.read(0, PREVIEW_BYTES);
    preview.textContent =
      new TextDecoder().decode(head) + (size > PREVIEW_BYTES ? '\n…' : '');
  } else {
    preview.hidden = true;
  }
  root.replaceChildren(
    el('p', {}, [
      el('strong', { textContent: name }),
      ` ${formatBytes(size)} `,
      el('span', { className: 'muted', textContent: type }),
    ]),
    get,
    preview,
    el('h2', { textContent: 'Share onward' }),
    sharePanel(file),
  );
};

/**
 * @param {HTMLElement} root
 * @param {any} gate the session's root capability
 */
const renderWelcome = (root, gate) => {
  const create = el('button', { textContent: 'Create a vault' });
  create.addEventListener('click', async () => {
    const { webkey } = await gate.createVault();
    location.hash = webkey;
  });
  root.replaceChildren(
    el('p', {}, [
      'Files are encrypted, stored on IPFS, and reached only through web-key links.',
    ]),
    create,
  );
};

/**
 * @param {object} io
 * @param {HTMLElement} io.root
 * @param {Location} io.location
 * @param {(url: string) => any} io.connect opens a Cap'n Web session
 */
const main = async ({ root, location, connect }) => {
  const gate = connect(`${location.origin.replace(/^http/, 'ws')}/api`);
  // The secret is read from the fragment, which the browser never sends in
  // a request line or a Referer header, and travels inside the session.
  const secret = decodeURIComponent(location.hash.slice(1));
  if (!secret) {
    renderWelcome(root, gate);
    return;
  }
  try {
    const { kind, vault, file } = await gate.open(secret);
    await (kind === 'vault'
      ? renderVault(root, vault)
      : renderFile(root, file));
  } catch (err) {
    root.replaceChildren(
      el('p', {
        className: 'error',
        textContent: `Cannot open: ${err.message}`,
      }),
    );
  }
};

const start = () =>
  main({
    root: document.getElementById('app'),
    location,
    connect: url => newWebSocketRpcSession(url),
  });

addEventListener('hashchange', start);
start();
