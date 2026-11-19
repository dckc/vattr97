#!/usr/bin/env node
/** @file Bundle toybox as a Cloudflare Worker, with a boot directory built in. */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HELP = `usage: ./build-cloudflare.js [--out DIR] BOOT_DIR [SOURCE_DIR]

Writes DIR/worker.js, from src/cloudflare.js, with the files of BOOT_DIR
built in as the kernel's boot directory and those of SOURCE_DIR as its
source directory (BOOT_DIR's, by default), and DIR/vat-runtime.txt, the
vat runtime the kernel loads as text. DIR is dist/cloudflare by default,
which wrangler.jsonc deploys as it is.
`;

/** @import { BuildOptions } from 'esbuild' */
/** @import { BootTree } from 'toybox-boot' */

const external = ['cloudflare:workers', 'node:*'];

/** @type {BuildOptions} */
const common = {
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'import'],
  external,
  logLevel: 'warning',
  // this package's directory, wherever the script is run from
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
};

/**
 * The files under `dir`, as a tree of their UTF-8 contents. Symlinks and
 * other non-files are refused, as the boot device refuses them.
 *
 * @param {string} dir
 * @param {{ readdir: typeof readdir, readFile: typeof readFile }} fs
 * @returns {Promise<BootTree>}
 */
const readTree = async (dir, fs) => {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  /** @type {BootTree} */
  const tree = {};
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) tree[entry.name] = await readTree(path, fs);
    else if (entry.isFile())
      tree[entry.name] = decoder.decode(await fs.readFile(path));
    else
      throw Error(`${path}: a boot directory has only files and directories`);
  }
  return tree;
};

/**
 * @param {object} [io] what main uses; Node's and esbuild's, by default
 * @param {string[]} [io.args]
 * @param {(text: string) => void} [io.print]
 * @param {typeof esbuild.build} [io.build]
 */
export const main = async ({
  args = process.argv.slice(2),
  print = text => void process.stdout.write(text),
  build = esbuild.build,
} = {}) => {
  const { values, positionals } = parseArgs({
    args,
    options: { out: { type: 'string' } },
    allowPositionals: true,
  });
  if (positionals.length < 1 || positionals.length > 2) return print(HELP);
  const [bootDir, sourceDir = bootDir] = positionals.map(d => resolve(d));
  const fs = { readdir, readFile };
  const trees = {
    'toybox-boot': await readTree(bootDir, fs),
    'toybox-source': await readTree(sourceDir, fs),
  };
  const out =
    values.out === undefined
      ? fileURLToPath(new URL('dist/cloudflare', import.meta.url))
      : resolve(values.out);
  await build({
    ...common,
    entryPoints: ['src/vat/runtime.js'],
    outfile: join(out, 'vat-runtime.txt'),
    external: [...external, './vat.js'],
  });
  await build({
    ...common,
    entryPoints: ['src/cloudflare.js'],
    outfile: join(out, 'worker.js'),
    external: [...external, 'vat-runtime.txt'],
    plugins: [
      {
        name: 'toybox-trees',
        setup(b) {
          b.onResolve({ filter: /^toybox-(boot|source)$/ }, ({ path }) => ({
            path,
            namespace: 'toybox-trees',
          }));
          b.onLoad({ filter: /.*/, namespace: 'toybox-trees' }, ({ path }) => ({
            contents: JSON.stringify(
              trees[/** @type {keyof typeof trees} */ (path)],
            ),
            loader: 'json',
          }));
        },
      },
    ],
  });
};

await main();
