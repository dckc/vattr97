/** @file Git worktrees, trees, and readers: files read only as a git tree lists them, and only while they hash to what it lists. */
import { encodeHex } from '@endo/hex';
import { M } from '@endo/patterns';
import { blobId, parseLsTree, treeId } from '../git-tree.js';
import { kzone } from './objects.js';

/** @import { KernelKey, TablePowers } from '../types.js' */

export const TABLES = {
  // a git tree (its id, in hex) and its files: JSON { path: blob id }
  kgittree:
    'CREATE TABLE IF NOT EXISTS kgittree (tree TEXT PRIMARY KEY, files TEXT NOT NULL)',
};

/** @typedef {{ kgittree: { tree: string, files: string } }} Tables */

/** About how much text, in UTF-16 units, a reader gives out at a time. */
const READ_CHUNK = 64 * 1024;

const TreeId = M.string();

/**
 * Text, as the worktree's bytes are: UTF-8, its BOM kept, as git hashes it.
 */
const makeDecoder = () =>
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Split text into chunks of whole lines, of about `size` each; the last
 * chunk may end without a newline.
 *
 * @param {string} pending text not yet given out
 * @param {number} size
 * @returns {[string, string]} a chunk to give out now (maybe empty), and what's left
 */
export const cutLines = (pending, size) => {
  const cut = pending.length >= size ? pending.lastIndexOf('\n') + 1 : 0;
  return [pending.slice(0, cut), pending.slice(cut)];
};

/**
 * Git worktrees, trees, and readers: files that must stay out of the
 * world-readable nix store, read from config.capnp's `git-worktree`
 * directory, but only as a git tree lists them.
 *
 * A worktree's `getTree(tree, listing)` takes what `git ls-tree -r <tree>`
 * lists (with or without `-z`) and answers a tree only if the listing hashes
 * to `tree` (or, given null, to whatever it hashes to: the tree's `id()`,
 * which vouches for nothing but the listing itself). The tree reads a file
 * only if it lists it, and only while its contents hash to the blob id
 * listed, so the files can't be swapped after the fact.
 *
 * `open(path)` answers a reader of a file too big for one message: the file
 * is hashed once before the reader is made, and again as the reader gives
 * it out, in chunks of whole lines. Those chunks are unchecked until the
 * reader says it's done, which it does only if what it gave out matches:
 * a consumer that acts on a chunk before then must be ready to undo it. A
 * reader lives in memory: once the kernel restarts, it only throws.
 *
 * @param {TablePowers<Tables>} powers
 * @param {object} io
 * @param {{ fetch: (url: string) => Promise<Response> }} io.worktree config.capnp's `git-worktree` service
 */
export const makeGit = ({ db, next, kernelObject, standIn }, { worktree }) => {
  /** @param {string} tree @returns {Record<string, string>} each file's blob id, by path */
  const filesOf = tree =>
    JSON.parse(db.lookup('kgittree', { tree }).one().files);

  /** The worktree's file at `path`, as `tree` lists it. @param {string} tree @param {string} path */
  const fetchListed = async (tree, path) => {
    if (!Object.hasOwn(filesOf(tree), path))
      throw Error(`tree ${tree} has no file ${JSON.stringify(path)}`);
    const resp = await worktree.fetch(
      `http://git-worktree/${path.split('/').map(encodeURIComponent).join('/')}`,
    );
    if (
      !resp.ok ||
      resp.headers.get('content-type') !== 'application/octet-stream' ||
      !resp.body
    )
      throw Error(`${path} is not a file in the worktree`);
    return resp;
  };

  /** @param {string} tree @param {string} path */
  const changed = (tree, path) =>
    Error(
      `${path} in the worktree is not what tree ${tree} has; it changed since`,
    );

  /**
   * A git blob hash of the file `resp` brings, fed as it streams in.
   *
   * @param {Response} resp
   */
  const startHash = async resp => {
    const header = resp.headers.get('content-length');
    const length = Number(header);
    // Number(null) is 0, so a missing header must be caught by name
    if (
      header === null ||
      !/^\d+$/.test(header) ||
      !Number.isSafeInteger(length)
    )
      throw Error('the worktree gave no length for that file');
    const digest = new crypto.DigestStream('SHA-1');
    const hashing = digest.getWriter();
    await hashing.write(new TextEncoder().encode(`blob ${length}\0`));
    let size = 0;
    return {
      /** @param {Uint8Array} chunk */
      write: async chunk => {
        size += chunk.length;
        await hashing.write(chunk);
      },
      /** @param {string} oid */
      matches: async oid => {
        await hashing.close();
        return (
          size === length &&
          encodeHex(new Uint8Array(await digest.digest)) === oid
        );
      },
    };
  };

  /**
   * The text of the file `resp` brings, in chunks of whole lines, hashed as
   * it's given out; the last chunk comes only once the whole file hashes to
   * `oid`, else `next()` throws `changedError()`.
   *
   * @param {Response} resp
   * @param {string} oid
   * @param {() => Error} changedError
   * @returns {Promise<() => Promise<IteratorResult<string, undefined>>>}
   */
  const checkedChunks = async (resp, oid, changedError) => {
    const hash = await startHash(resp);
    const decoder = makeDecoder();
    const bytes = /** @type {ReadableStream<Uint8Array>} */ (
      resp.body
    ).getReader();
    let pending = '';
    let finished = false;
    /** @type {Error | undefined} */
    let failed;
    /** @returns {Promise<IteratorResult<string, undefined>>} */
    const step = async () => {
      while (!finished) {
        const { value, done } = await bytes.read();
        if (done) {
          finished = true;
          if (!(await hash.matches(oid))) throw changedError();
          const last = pending + decoder.decode();
          if (last) return { done: false, value: last };
          break;
        }
        await hash.write(value);
        let out;
        [out, pending] = cutLines(
          pending + decoder.decode(value, { stream: true }),
          READ_CHUNK,
        );
        if (out) return { done: false, value: out };
      }
      return { done: true, value: undefined };
    };
    // once it fails, it stays failed: no later call may say done
    return async () => {
      if (failed) throw failed;
      try {
        return await step();
      } catch (e) {
        failed = /** @type {Error} */ (e);
        throw e;
      }
    };
  };

  /** Each open reader's next chunk, by key: in memory only. @type {Map<string, () => Promise<IteratorResult<string, undefined>>>} */
  const live = new Map();

  const worktrees = kzone.exoClass(
    'GitWorktree',
    M.interface('GitWorktree', {
      getTree: M.call(M.or(TreeId, M.null()), M.string()).returns(M.promise()),
    }),
    {
      /** @param {string | null} tree @param {string} listing */
      async getTree(tree, listing) {
        if (tree !== null && !/^[0-9a-f]{40}$/.test(tree))
          throw Error(`not a git tree id: ${JSON.stringify(tree)}`);
        const files = parseLsTree(listing);
        const actual = await treeId(files);
        if (tree !== null && actual !== tree)
          throw Error(`that listing is of tree ${actual}, not ${tree}`);
        db.insertOrIgnore('kgittree', {
          tree: actual,
          files: JSON.stringify(
            Object.fromEntries(files.map(({ path, oid }) => [path, oid])),
          ),
        });
        return standIn(kernelObject(`gitTree:${actual}`));
      },
    },
  );

  const trees = kzone.exoClass(
    'GitTree',
    M.interface('GitTree', {
      id: M.call().returns(TreeId),
      list: M.call().returns(M.arrayOf(M.string())),
      read: M.call(M.string()).returns(M.promise()),
      open: M.call(M.string()).returns(M.promise()),
    }),
    {
      id() {
        return this.state.rest;
      },
      list() {
        return harden(Object.keys(filesOf(this.state.rest)).sort());
      },
      /** @param {string} path */
      async read(path) {
        const tree = this.state.rest;
        const resp = await fetchListed(tree, path);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        if ((await blobId(bytes)) !== filesOf(tree)[path])
          throw changed(tree, path);
        return makeDecoder().decode(bytes);
      },
      /** @param {string} path */
      async open(path) {
        const tree = this.state.rest;
        const oid = filesOf(tree)[path];
        const before = await fetchListed(tree, path);
        const hash = await startHash(before);
        for await (const chunk of /** @type {ReadableStream<Uint8Array>} */ (
          before.body
        ))
          await hash.write(chunk);
        if (!(await hash.matches(oid))) throw changed(tree, path);
        /** @type {KernelKey} */
        const key = `gitReader:${next('gitReader')}`;
        live.set(
          key,
          await checkedChunks(await fetchListed(tree, path), oid, () =>
            changed(tree, path),
          ),
        );
        return standIn(kernelObject(key));
      },
    },
  );

  const readers = kzone.exoClass(
    'GitReader',
    M.interface('GitReader', {
      next: M.callWhen().returns(
        M.splitRecord(
          { done: M.boolean() },
          { value: M.or(M.string(), M.undefined()) },
        ),
      ),
    }),
    {
      /**
       * The file's next chunk of text, whole lines but for a last one with
       * no newline. Throws if the file changed since it was opened, or if
       * the kernel restarted since.
       */
      async next() {
        const next = live.get(`gitReader:${this.state.rest}`);
        if (!next)
          throw Error(
            'this reader ended when the kernel restarted; open the file again',
          );
        return harden(await next());
      },
    },
  );

  return harden({
    worktrees,
    trees,
    readers,
    /** A git worktree: whoever holds it can read any file in the worktree whose git blob id they know. */
    make: () => kernelObject(`gitWorktree:${next('gitWorktree')}`),
  });
};
