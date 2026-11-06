/** @file Bundles: a vat's code, kept by the hash of its files and manifest, and their bundleCaps. */
import { encodeHex } from '@endo/hex';
import { M } from '@endo/patterns';
import { kzone } from './objects.js';

/** @import { BundleCode, Kref, Manifest, TablePowers } from '../types.js' */

export const TABLES = {
  // manifest: JSON { mainModule, compatibilityDate, compatibilityFlags }
  kbundlemanifest:
    'CREATE TABLE IF NOT EXISTS kbundlemanifest (hash TEXT PRIMARY KEY, manifest TEXT NOT NULL)',
  kbundlefile:
    'CREATE TABLE IF NOT EXISTS kbundlefile (hash TEXT NOT NULL, name TEXT NOT NULL, content BLOB NOT NULL, PRIMARY KEY (hash, name))',
};

/**
 * @typedef {object} Tables
 * @property {{ hash: string, manifest: string }} kbundlemanifest
 * @property {{ hash: string, name: string, content: ArrayBuffer | Uint8Array }} kbundlefile
 */

/** The compatibility date of a bundle that names none. */
export const COMPATIBILITY_DATE = '2026-10-01';

/** A bundle's hash ({@link bundleHash}): SHA-256, in hex. */
const HASH = /^[0-9a-f]{64}$/;

/** Worker Loader module types, by file extension; any other file is `data`. */
const MODULE_TYPES = /** @type {Record<string, string>} */ ({
  js: 'js',
  mjs: 'js',
  cjs: 'cjs',
  py: 'py',
  txt: 'text',
  json: 'json',
  wasm: 'wasm',
});

/**
 * A bundle file's text, a leading BOM dropped, as a module's source wants
 * it. (A git reader keeps the BOM, since git hashes it.)
 *
 * @param {ArrayBuffer | Uint8Array} buf
 */
export const decode = buf =>
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);

/**
 * A Worker Loader module for the file `name`, typed by its extension.
 *
 * @param {string} name
 * @param {ArrayBuffer | Uint8Array} content
 */
export const loaderModule = (name, content) => {
  const type = MODULE_TYPES[name.slice(name.lastIndexOf('.') + 1)] ?? 'data';
  if (type === 'data' || type === 'wasm') return { [type]: content };
  if (type === 'json') {
    try {
      return { json: JSON.parse(decode(content)) };
    } catch (e) {
      throw Error(`${name}: ${/** @type {Error} */ (e).message}`, { cause: e });
    }
  }
  return { [type]: decode(content) };
};

/** @param {BufferSource} bytes */
const sha256 = async bytes =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

/**
 * The hash a bundle is kept by: SHA-256 of JSON `[manifest, [[name, hash],
 * ...]]`, its files in name order, each with its own SHA-256 in hex. The
 * same files and manifest have the same hash wherever they were read from.
 *
 * @param {{ manifest: Manifest, files: Record<string, Uint8Array> }} bundle
 */
export const bundleHash = async ({ manifest, files }) => {
  const { mainModule, compatibilityDate, compatibilityFlags } = manifest;
  const digests = await Promise.all(
    Object.keys(files)
      .sort()
      .map(async name => [name, encodeHex(await sha256(files[name]))]),
  );
  const json = JSON.stringify([
    { mainModule, compatibilityDate, compatibilityFlags },
    digests,
  ]);
  return encodeHex(await sha256(new TextEncoder().encode(json)));
};

/** @param {TablePowers<Tables>} powers */
export const makeBundles = ({ db, kernelObject, keyOf }) => {
  /**
   * The bundleCap for a bundle's hash: `bundle:<hash>`.
   *
   * @param {string} hash
   */
  const cap = hash => kernelObject(`bundle:${hash}`);

  /**
   * Keep a bundle; answers its bundleCap.
   *
   * @param {{ manifest: Manifest, files: Record<string, Uint8Array> }} bundle
   */
  const installFiles = async ({ manifest, files }) => {
    const hash = await bundleHash({ manifest, files });
    db.insertOrIgnore('kbundlemanifest', {
      hash,
      manifest: JSON.stringify(manifest),
    });
    for (const [name, content] of Object.entries(files))
      db.insertOrIgnore('kbundlefile', { hash, name, content });
    return cap(hash);
  };

  return harden({
    ...kzone.exoClass('BundleCap', M.interface('BundleCap', {}), {}),
    cap,
    installFiles,
    /**
     * Keep `src` as a bundle of one module; answers its bundleCap.
     *
     * @param {string} src an ES module exporting `buildRootObject(vatPowers, params)`
     */
    install: src =>
      installFiles({
        manifest: {
          mainModule: 'main.js',
          compatibilityDate: COMPATIBILITY_DATE,
          compatibilityFlags: [],
        },
        files: { 'main.js': new TextEncoder().encode(src) },
      }),
    /**
     * The hash the bundleCap `kref` designates.
     *
     * @param {Kref | undefined} kref
     */
    hashOf(kref) {
      const [kind, hash] = (kref && keyOf(kref))?.split(':') ?? [];
      if (kind !== 'bundle') throw Error('that is not a bundleCap');
      return db.lookup('kbundlemanifest', { hash }).one().hash;
    },
    /**
     * The bundle `hash`, as the Worker Loader runs it: its files under
     * `bundle/`, and `vat.js`, which re-exports its main module.
     *
     * @param {string} hash
     * @returns {BundleCode}
     */
    code(hash) {
      if (!HASH.test(hash)) throw Error(`not a bundle hash: ${hash}`);
      /** @type {Manifest} */
      const { mainModule, compatibilityDate, compatibilityFlags } = JSON.parse(
        db.lookup('kbundlemanifest', { hash }).one().manifest,
      );
      /** @type {Record<string, unknown>} */
      const modules = {
        'vat.js': `export * from ${JSON.stringify(`./bundle/${mainModule}`)};`,
      };
      for (const { name, content } of db.query('kbundlefile', { hash }))
        modules[`bundle/${name}`] = loaderModule(name, content);
      return { compatibilityDate, compatibilityFlags, modules };
    },
  });
};
