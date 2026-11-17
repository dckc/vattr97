#!/usr/bin/env node
/**
 * @file Assemble the boot directory, dist/boot: this package's boot vat
 * and pacer vat, the cache and gateway vats as directory bundles, and the toybox vats
 * they use (the WebApp maker, the store maker, the session keeper).
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

/**
 * @param {object} [io]
 * @param {URL} [io.here] this package
 */
const main = async ({ here = new URL('./', import.meta.url) } = {}) => {
  const at = (/** @type {string} */ p) => new URL(p, here);
  const out = at('dist/boot/');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(at('src/boot.js'), new URL('boot.js', out));
  await cp(at('src/pacer.js'), new URL('pacer.js', out));
  for (const name of ['webapp.js', 'store-maker.js', 'session-keeper.js'])
    await cp(at(`../toybox/examples/${name}`), new URL(name, out));
  for (const [dir, mainModule] of [
    ['cache', 'cache.js'],
    ['gateway', 'gateway.js'],
  ]) {
    await cp(at(`src/${dir}/`), new URL(`${dir}/`, out), { recursive: true });
    await writeFile(
      new URL(`${dir}/worker.json`, out),
      JSON.stringify({ mainModule }),
    );
  }
};

await main();
