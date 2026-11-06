/** @file Git repositories for tests, through the `git` command. */
import { join } from 'node:path';

/**
 * @param {object} io
 * @param {(file: string, args: string[]) => Promise<{ stdout: string }>} io.run runs a command
 * @param {(src: string, dest: string, opts: { recursive: boolean, verbatimSymlinks: boolean }) => Promise<void>} io.cp
 * @param {() => Promise<string>} io.makeScratchDir a new, empty directory
 */
export const makeGit = ({ run, cp, makeScratchDir }) =>
  harden({
    /**
     * A scratch repository holding a copy of `dir` at `under`, all of it
     * staged: its tree's id, as `git write-tree` reports it, and that
     * tree's listing, as `git ls-tree -r -z` gives it.
     *
     * @param {string} dir
     * @param {string} [under] a path in the repository
     * @param {string} [repo] where the repository goes; a new scratch directory if absent
     */
    makeRepo: async (dir, under = '.', repo = undefined) => {
      const at = repo ?? (await makeScratchDir());
      await cp(dir, join(at, under), {
        recursive: true,
        verbatimSymlinks: true,
      });
      /** @param {string[]} args */
      const git = async (...args) =>
        (await run('git', ['-C', at, ...args])).stdout;
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
