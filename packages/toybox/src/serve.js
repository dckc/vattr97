/**
 * @file Run a toybox from a boot directory, keeping its state, and print the boot vat's link: what `scripts/serve.js` runs, once lockdown is done.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { E } from '@endo/far';
import { makeTree } from './dir-tree.js';
import { makeToyboxes } from './toyboxes.js';
import { makeWorkerd } from './workerd-process.js';

/**
 * @import { WorkerdIO } from './workerd-process.js';
 * @import { FsIO } from './dir-tree.js';
 */

const HELP = `usage: scripts/serve.js STATE_DIR BOOT_DIR [--source DIR] [--checkout DIR] [--port PORT] [--link-file FILE]

Runs toybox (workerd, on this package's config.capnp) with its state in
STATE_DIR, made if need be and kept across runs, and BOOT_DIR as its boot
directory: the kernel \`main\` boots from BOOT_DIR/boot.js. The app socket
is http://127.0.0.1:PORT/ (PORT is 8788 by default), the http socket is
on PORT+1, and the admin socket is STATE_DIR/admin.sock. The source
device reads bundles by path from the source DIR (BOOT_DIR by default);
git trees, from the git checkout DIR (STATE_DIR/checkout by default).

If the boot vat answers provideOwnerLink(), prints "open: " and the app socket's
URL with that link appended: whoever opens it holds what it designates.
With --link-file, writes that URL to FILE instead, readable by its owner
alone, and prints only where it is and its fingerprint, so a log that
keeps what's printed (such as a systemd unit's journal) doesn't keep the
link. Runs until interrupted or terminated; workerd's log goes to stderr.
`;

/**
 * A secret's fingerprint, for a log to say which one without holding it:
 * the first 6 bytes of its SHA-256, in hex.
 *
 * @param {string} secret
 */
export const fingerprint = async secret => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );
  return [...new Uint8Array(digest).slice(0, 6)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * @param {object} io what the script hands on
 * @param {string[]} io.args
 * @param {(text: string) => void} io.print
 * @param {Promise<void>} io.stopped settles when asked to stop
 * @param {string} io.cwd the directory relative arguments are in
 * @param {string} io.pkgDir this package's directory
 * @param {FsIO} io.fs
 * @param {WorkerdIO} io.workerdIO
 * @param {typeof fetch} io.fetch for the toybox's http and app sockets
 * @param {new (url: string) => import('ws').WebSocket} io.WebSocket for its admin socket
 */
export const main = async ({
  args,
  print,
  stopped,
  cwd,
  pkgDir,
  fs,
  workerdIO,
  fetch,
  WebSocket,
}) => {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        source: { type: 'string' },
        checkout: { type: 'string' },
        port: { type: 'string' },
        'link-file': { type: 'string' },
      },
    });
  } catch {
    return print(HELP);
  }
  const { positionals, values } = parsed;
  const port = Number(values.port ?? '8788');
  // PORT+1 is the http socket's, so it must be a port too
  const portOk = Number.isInteger(port) && port > 0 && port < 65535;
  if (positionals.length !== 2 || !portOk) return print(HELP);
  /** @param {string} path */
  const openDir = path => makeTree(fs, resolve(cwd, path));
  const { startToybox } = makeToyboxes({
    ...makeWorkerd(workerdIO),
    pkg: makeTree(fs, pkgDir),
    fetch,
    WebSocket,
  });
  const [dir, boot] = positionals.map(openDir);
  const box = await startToybox(dir, {
    boot,
    source: values.source === undefined ? boot : openDir(values.source),
    checkout:
      values.checkout === undefined ? undefined : openDir(values.checkout),
    port,
  });
  try {
    // the first request to the app socket starts the boot vat
    await box.app('/');
    const kernel = await box.admin();
    const [bootVat] = await kernel.vats();
    const link = bootVat
      ? await E(bootVat.root)
          .provideOwnerLink()
          .catch(() => '')
      : '';
    kernel.close();
    const url = `${box.appOrigin}/${link}`;
    const file = values['link-file'];
    if (file === undefined) print(`open: ${url}\n`);
    else {
      const path = resolve(cwd, file);
      await fs.writeFile(path, `${url}\n`, { mode: 0o600 });
      // writeFile's mode applies only to a new file
      await fs.chmod(path, 0o600);
      print(`open: the link in ${path} (sha256 ${await fingerprint(url)}…)\n`);
    }
    await stopped;
  } finally {
    await box.stop();
  }
};
