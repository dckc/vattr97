/** @file Git repositories for tests, through the `git` command. */

/** @import { Tree } from '../src/dir-tree.js' */

/**
 * @param {object} io
 * @param {(file: string, args: string[]) => Promise<{ stdout: string }>} io.run runs a command
 * @param {() => Promise<Tree>} io.makeScratchDir a new, empty directory
 */
export const makeGit = ({ run, makeScratchDir }) =>
  harden({
    /**
     * A scratch repository holding a copy of `src` at `under`, all of it
     * staged: its tree's id, as `git write-tree` reports it, and that
     * tree's listing, as `git ls-tree -r -z` gives it.
     *
     * @param {Tree} src
     * @param {string} [under] a path in the repository; its top by default
     * @param {Tree} [repo] where the repository goes; a new scratch directory if absent
     */
    makeRepo: async (src, under = '', repo = undefined) => {
      const at = repo ?? (await makeScratchDir());
      await src.copy('', at, under);
      /** @param {string[]} args */
      const git = async (...args) =>
        (await run('git', ['-C', at.path(), ...args])).stdout;
      await git('init', '-q');
      await git('add', '-A');
      const tree = (await git('write-tree')).trim();
      return {
        repo: at,
        tree,
        listing: await git('ls-tree', '-r', '-z', tree),
      };
    },
  });
