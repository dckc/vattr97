/** @file Add files to the local nix store for tests, through the `nix` command. */

/**
 * @param {object} io
 * @param {(file: string, args: string[]) => Promise<{ stdout: string }>} io.run runs a command; the test supplies it
 */
export const makeNix = ({ run }) =>
  harden({
    /** Add `path` (a file or directory) to the store; answers its store path. @param {string} path */
    addToStore: async path =>
      (await run('nix', ['store', 'add-path', path])).stdout.trim(),
  });
