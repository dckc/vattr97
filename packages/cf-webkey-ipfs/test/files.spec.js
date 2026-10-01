import { describe, it, expect } from 'vitest';
import { makeCipher } from '../src/cipher.js';
import { makeFileStore } from '../src/files.js';
import {
  getRandomValues,
  includesBytes,
  makeMemoryBlocks,
  subtle,
  text,
  utf8,
} from './support.js';

const makeStore = (chunkBytes = 16) => {
  const blocks = makeMemoryBlocks();
  const cipher = makeCipher({ subtle, getRandomValues });
  return { blocks, files: makeFileStore({ blocks, cipher, chunkBytes }) };
};

const PLAIN = utf8('The quick brown fox jumps over the lazy dog. '.repeat(4));

describe('encrypted files', () => {
  it('round-trip across many chunks', async () => {
    const { blocks, files } = makeStore();
    const ref = await files.write(PLAIN);
    expect(ref.size).toBe(PLAIN.length);
    expect(blocks.stored.size).toBe(Math.ceil(PLAIN.length / 16) + 1);
    const reader = await files.open(ref);
    expect(await reader.read(0, PLAIN.length)).toEqual(PLAIN);
  });

  it('read any byte range, short at end of file', async () => {
    const { files } = makeStore();
    const reader = await files.open(await files.write(PLAIN));
    expect(text(await reader.read(4, 15))).toBe('quick brown fox');
    expect(text(await reader.read(16, 16))).toBe(text(PLAIN.subarray(16, 32)));
    expect(await reader.read(PLAIN.length - 3, 100)).toEqual(
      PLAIN.subarray(-3),
    );
    expect((await reader.read(PLAIN.length + 5, 10)).length).toBe(0);
  });

  it('round-trip an empty file', async () => {
    const { files } = makeStore();
    const reader = await files.open(await files.write(new Uint8Array(0)));
    expect(reader.size).toBe(0);
    expect((await reader.read(0, 10)).length).toBe(0);
  });

  it('put only ciphertext in the block store', async () => {
    const { blocks, files } = makeStore(64);
    await files.write(PLAIN);
    for (const bytes of blocks.stored.values()) {
      expect(includesBytes(bytes, utf8('quick'))).toBe(false);
      expect(includesBytes(bytes, utf8('chunks'))).toBe(false);
    }
  });

  it('use a fresh key per file, so equal files share no blocks', async () => {
    const { blocks, files } = makeStore();
    const a = await files.write(PLAIN);
    const b = await files.write(PLAIN);
    expect(a.key).not.toBe(b.key);
    expect(a.cid).not.toBe(b.cid);
    expect(blocks.stored.size).toBe(2 * (Math.ceil(PLAIN.length / 16) + 1));
  });

  it('cannot be opened with the wrong key', async () => {
    const { files } = makeStore();
    const a = await files.write(PLAIN);
    const b = await files.write(PLAIN);
    await expect(files.open({ cid: a.cid, key: b.key })).rejects.toThrow();
  });

  it('reject a block that was swapped for another', async () => {
    const { blocks, files } = makeStore();
    const ref = await files.write(PLAIN);
    const [first, second] = [...blocks.stored.keys()];
    blocks.stored.set(first, blocks.stored.get(second));
    const reader = await files.open(ref);
    await expect(reader.read(0, 16)).rejects.toThrow(/does not match/);
  });
});
