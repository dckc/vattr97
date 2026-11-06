/** @file Types of toybox's own I/O devices, and of what their modules take and give. */

/** What a fetch device sends. */
export type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

/** What a fetch device answers: the body as text. */
export type FetchAnswer = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

/** A store path's contents, without executable bits or symlinks (nix/nar.js). */
export type NarNode =
  | { type: 'regular'; contents: Uint8Array }
  | { type: 'directory'; entries: Record<string, NarNode> };

/** A regular file in a git tree, as `git ls-tree -r` lists it (git/git-tree.js). */
export type TreeFile = {
  mode: '100644' | '100755';
  path: string;
  oid: string;
};
