/** @file NAR hashes, as nix computes them, for store paths of regular files and directories. @see {@link narHash} */

import { encodeBase64 } from '@endo/base64';
import { compareUtf8 } from '../byte-order.js';

const encoder = new TextEncoder();

/** @import { NarNode } from '../../types.js' */

/** A NAR string: its length as a 64-bit little-endian integer, its bytes, zeros to a multiple of 8. @param {Uint8Array | string} s */
const narString = s => {
  const bytes = typeof s === 'string' ? encoder.encode(s) : s;
  const out = new Uint8Array(8 + Math.ceil(bytes.length / 8) * 8);
  new DataView(out.buffer).setBigUint64(0, BigInt(bytes.length), true);
  out.set(bytes, 8);
  return out;
};

/** @param {string} name */
const checkName = name => {
  if (name === '' || name === '.' || name === '..' || /[/\0]/.test(name))
    throw Error(
      `not a name nix allows in a store path: ${JSON.stringify(name)}`,
    );
};

/** @param {NarNode} node @returns {Uint8Array[]} */
const serialize = node => {
  if (node.type === 'regular')
    return ['(', 'type', 'regular', 'contents', node.contents, ')'].map(
      narString,
    );
  const entries = Object.keys(node.entries)
    .sort(compareUtf8)
    .flatMap(name => {
      checkName(name);
      return [
        ...'entry,(,name'.split(',').map(narString),
        narString(name),
        narString('node'),
        ...serialize(node.entries[name]),
        narString(')'),
      ];
    });
  return [
    ...['(', 'type', 'directory'].map(narString),
    ...entries,
    narString(')'),
  ];
};

/**
 * The NAR hash of a store path whose contents are `node`, in the SRI form
 * `nix path-info --json` reports (`sha256-<base64>`). Every file counts as
 * non-executable.
 *
 * @param {NarNode} node
 * @see https://nix.dev/manual/nix/2.35/protocols/nix-archive/
 */
export const narHash = async node => {
  const parts = [narString('nix-archive-1'), ...serialize(node)];
  const nar = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (nar.set(p, at), at + p.length), 0);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', nar));
  return `sha256-${encodeBase64(digest)}`;
};
