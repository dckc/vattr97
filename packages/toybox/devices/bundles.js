/** @file Bundles, kept by hash, and their bundleCaps. */
import { M } from '@endo/patterns';
import { kzone } from './objects.js';

/** @import { Kref, TablePowers } from '../types.js' */

export const TABLES = {
  kbundle:
    'CREATE TABLE IF NOT EXISTS kbundle (hash TEXT PRIMARY KEY, src TEXT NOT NULL)',
  // a bundle from the nix store, by NAR hash (SRI); manifest: JSON { mainModule, compatibilityDate, compatibilityFlags }
  knar: 'CREATE TABLE IF NOT EXISTS knar (nar TEXT PRIMARY KEY, manifest TEXT NOT NULL)',
  knarmodule:
    'CREATE TABLE IF NOT EXISTS knarmodule (nar TEXT NOT NULL, name TEXT NOT NULL, content BLOB NOT NULL, PRIMARY KEY (nar, name))',
};

/**
 * @typedef {object} Tables
 * @property {{ hash: string, src: string }} kbundle
 * @property {{ nar: string, manifest: string }} knar
 * @property {{ nar: string, name: string, content: ArrayBuffer | Uint8Array }} knarmodule
 */

/** The compatibility date of a bundle that names none. */
export const COMPATIBILITY_DATE = '2026-10-01';

/**
 * What a nix store bundle says of itself, in its worker.json.
 *
 * @typedef {{ mainModule: string, compatibilityDate: string, compatibilityFlags: string[] }} Manifest
 */

/**
 * What the Worker Loader runs a bundle as, beside the vat runtime: its
 * modules, and the compatibility it asks for.
 *
 * @typedef {{ compatibilityDate: string, compatibilityFlags?: string[], modules: Record<string, unknown> }} BundleCode
 */

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

/** @param {ArrayBuffer | Uint8Array} buf */
export const decode = buf =>
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);

/** @param {ArrayBuffer | Uint8Array} buf */
export const hex = buf =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

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

/** @param {TablePowers<Tables>} powers */
export const makeBundles = ({ db, kernelObject, keyOf }) => {
  /**
   * The bundleCap for a hash: `bundle:sha256:<hex>` for source installed
   * directly, `bundle:nar:sha256-<base64>` for a nix store path.
   *
   * @param {'sha256' | 'nar'} alg
   * @param {string} digest
   */
  const cap = (alg, digest) => kernelObject(`bundle:${alg}:${digest}`);

  return harden({
    ...kzone.exoClass('BundleCap', M.interface('BundleCap', {}), {}),
    cap,
    /**
     * Keep `src` as a bundle; answers its bundleCap.
     *
     * @param {string} src an ES module exporting `buildRootObject(vatPowers, params)`
     */
    async install(src) {
      const hash = hex(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src)),
      );
      db.insertOrIgnore('kbundle', { hash, src });
      return cap('sha256', hash);
    },
    /**
     * Keep a nix store path's files as a bundle, by its NAR hash; answers
     * its bundleCap.
     *
     * @param {string} nar
     * @param {Manifest} manifest
     * @param {Record<string, Uint8Array>} files
     */
    installNar(nar, manifest, files) {
      db.insertOrIgnore('knar', { nar, manifest: JSON.stringify(manifest) });
      for (const [name, content] of Object.entries(files))
        db.insertOrIgnore('knarmodule', { nar, name, content });
      return cap('nar', nar);
    },
    /**
     * The hash the bundleCap `kref` designates.
     *
     * @param {Kref | undefined} kref
     */
    hashOf(kref) {
      const [kind, alg, digest] = (kref && keyOf(kref))?.split(':') ?? [];
      if (kind !== 'bundle') throw Error('that is not a bundleCap');
      if (alg === 'sha256')
        return db.lookup('kbundle', { hash: digest }).one().hash;
      if (alg === 'nar') return db.lookup('knar', { nar: digest }).one().nar;
      throw Error(`no ${alg} bundles here`);
    },
    /**
     * The bundle `hash`, as the Worker Loader runs it: a bundle installed
     * directly is `vat.js`; one from the nix store is its modules under
     * `bundle/`, and `vat.js` re-exports its main module.
     *
     * @param {string} hash a `kbundle` hash or a `knar` NAR hash
     * @returns {BundleCode}
     */
    code(hash) {
      const bundle = db.lookup('kbundle', { hash }).get();
      if (bundle)
        return {
          compatibilityDate: COMPATIBILITY_DATE,
          modules: { 'vat.js': bundle.src },
        };
      /** @type {Manifest} */
      const { mainModule, compatibilityDate, compatibilityFlags } = JSON.parse(
        db.lookup('knar', { nar: hash }).one().manifest,
      );
      /** @type {Record<string, unknown>} */
      const modules = {
        'vat.js': `export * from ${JSON.stringify(`./bundle/${mainModule}`)};`,
      };
      for (const { name, content } of db.query('knarmodule', { nar: hash }))
        modules[`bundle/${name}`] = loaderModule(name, content);
      return { compatibilityDate, compatibilityFlags, modules };
    },
  });
};
