/** @file A directory, and the tree under it by relative path, as `openat` reaches it: what a test or script holds of the filesystem. */
import { dirname, join } from 'node:path';

/** @param {string} name */
const isName = name => !['', '.', '..'].includes(name) && !/[\\\0]/.test(name);

/** @typedef {Pick<typeof import('node:fs/promises'), 'chmod' | 'cp' | 'mkdir' | 'readFile' | 'rm' | 'symlink' | 'writeFile'>} FsIO what a tree does its I/O with */

/**
 * The directory `root`, and only what's under it.
 *
 * @param {FsIO} io
 * @param {string} root
 */
export const makeTree = (io, root) => {
  /** @param {string} rel */
  const at = rel => {
    if (rel === '') return root;
    const names = rel.split('/');
    if (!names.every(isName)) throw Error(`not a path under ${root}: ${rel}`);
    return join(root, ...names);
  };
  return harden({
    /**
     * `rel`'s absolute path, for what takes one, such as workerd's `-d`.
     *
     * @param {string} [rel]
     */
    path: (rel = '') => at(rel),
    /** @param {string} rel */
    sub: rel => makeTree(io, at(rel)),
    /**
     * Make the directory `rel`, and those it's in, if they aren't there.
     *
     * @param {string} [rel]
     */
    ensureDir: async (rel = '') => {
      await io.mkdir(at(rel), { recursive: true });
    },
    /** @param {string} rel */
    read: rel => io.readFile(at(rel)),
    /** @param {string} rel */
    readText: rel => io.readFile(at(rel), 'utf8'),
    /**
     * Write `text` to `rel`, making the directories it's in.
     *
     * @param {string} rel
     * @param {string} text
     */
    async writeText(rel, text) {
      await io.mkdir(dirname(at(rel)), { recursive: true });
      await io.writeFile(at(rel), text);
    },
    /**
     * Make `rel` a symlink to `target`, a path relative to the directory it's in.
     *
     * @param {string} target
     * @param {string} rel
     */
    symlink: (target, rel) => io.symlink(target, at(rel)),
    /** @param {string} rel @param {number} mode */
    chmod: (rel, mode) => io.chmod(at(rel), mode),
    /**
     * Copy `rel`, a file or a directory, to `destRel` in `dest`; a symlink
     * stays a symlink to what it named.
     *
     * @param {string} rel
     * @param {{ path: (rel?: string) => string }} dest
     * @param {string} [destRel]
     */
    copy: (rel, dest, destRel) =>
      io.cp(at(rel), dest.path(destRel), {
        recursive: true,
        verbatimSymlinks: true,
      }),
    /** Remove the directory, and everything under it. */
    remove: () => io.rm(root, { recursive: true, force: true }),
  });
};

/** @typedef {ReturnType<typeof makeTree>} Tree */
