/**
 * @file Start a toybox in a scratch directory and serve a hello-world vat: what `scripts/hello.js` runs, once lockdown is done.
 */
import { makeTree } from './dir-tree.js';
import { makeToyboxes } from './toyboxes.js';
import { makeWorkerd } from './workerd-process.js';

/**
 * @import { WorkerdIO } from './workerd-process.js';
 * @import { FsIO } from './dir-tree.js';
 */

const HELP = `usage: scripts/hello.js

Starts toybox (workerd, on this package's config.capnp) with its state in a
new temporary directory, runs the hello page (examples/hello-page.js) in it,
served at an ingress. Prints the URL to open. Ctrl-C stops toybox and
removes the directory.
`;

/**
 * @param {object} io what the script hands on
 * @param {string[]} io.args
 * @param {(text: string) => void} io.print
 * @param {Promise<void>} io.interrupted settles when the user asks to stop
 * @param {string} io.pkgDir this package's directory
 * @param {() => Promise<string>} io.makeScratchDir a new temporary directory
 * @param {FsIO} io.fs
 * @param {WorkerdIO} io.workerdIO
 * @param {typeof fetch} io.fetch for the toybox's http and app sockets
 * @param {new (url: string) => import('ws').WebSocket} io.WebSocket for its admin socket
 */
export const main = async ({
  args,
  print,
  interrupted,
  pkgDir,
  makeScratchDir,
  fs,
  workerdIO,
  fetch,
  WebSocket,
}) => {
  if (args.length) return print(HELP);
  const pkg = makeTree(fs, pkgDir);
  const { startToybox } = makeToyboxes({
    ...makeWorkerd(workerdIO),
    pkg,
    fetch,
    WebSocket,
  });
  const dir = makeTree(fs, await makeScratchDir());
  try {
    const box = await startToybox(dir);
    try {
      const kernel = await box.admin('hello');
      const ingress = await kernel.makeIngress({ app: 'hello' });
      await kernel.createVat(await pkg.readText('examples/hello-page.js'), {
        ingress,
      });
      kernel.close();
      print(`open ${box.httpOrigin}/?app=hello\n(Ctrl-C to stop)\n`);
      await interrupted;
    } finally {
      await box.stop();
    }
  } finally {
    await dir.remove();
  }
};
