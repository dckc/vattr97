import { describe, it, expect } from 'vitest';
import { includesBytes, makeTestService, text, utf8 } from './support.js';

const REPORT = utf8('Q3 revenue was up; do not forward.');

/** A vault holding one file, as its owner sees it. */
const makeOwner = async () => {
  const service = makeTestService();
  const { webkey } = await service.gate.createVault();
  const { vault } = await service.gate.open(webkey);
  await vault.put('report.txt', REPORT, 'text/plain');
  return { ...service, vault, vaultKey: webkey };
};

describe('a vault', () => {
  it('is reached again from its web-key secret', async () => {
    const { gate, vaultKey } = await makeOwner();
    expect(vaultKey).toMatch(/^vault:[a-z2-7]{26}$/);
    const { kind, vault } = await gate.open(vaultKey);
    expect(kind).toBe('vault');
    expect(await vault.list()).toEqual([
      expect.objectContaining({ name: 'report.txt', size: REPORT.length }),
    ]);
  });

  it('stores a file and reads it back', async () => {
    const { vault } = await makeOwner();
    const file = await vault.get('report.txt');
    expect(await file.stat()).toEqual({
      name: 'report.txt',
      type: 'text/plain',
      size: REPORT.length,
    });
    expect(text(await file.read(0, 1024))).toBe(text(REPORT));
  });

  it('replaces a file put under the same name', async () => {
    const { vault } = await makeOwner();
    await vault.put('report.txt', utf8('v2'), 'text/plain');
    expect((await vault.list()).length).toBe(1);
    const file = await vault.get('report.txt');
    expect(text(await file.read(0, 10))).toBe('v2');
  });

  it('rejects names that are not plain file names', async () => {
    const { vault } = await makeOwner();
    for (const bad of ['', 'a/b', '..\\x', 'x\n', 7]) {
      await expect(vault.put(bad, REPORT)).rejects.toThrow('bad file name');
    }
  });

  it('leaves nothing readable in blocks or rows', async () => {
    const { blocks, store, vaultKey } = await makeOwner();
    const everything = [
      ...blocks.stored.values(),
      ...[...store.rows.values()].map(row => row.sealed),
      utf8(JSON.stringify([...store.rows.keys()])),
    ];
    for (const bytes of everything) {
      expect(includesBytes(bytes, utf8('revenue'))).toBe(false);
      expect(includesBytes(bytes, utf8('report.txt'))).toBe(false);
      expect(includesBytes(bytes, utf8(vaultKey.split(':')[1]))).toBe(false);
    }
  });
});

describe('a shared file', () => {
  it('is read by whoever presents its web-key secret', async () => {
    const { gate, vault } = await makeOwner();
    const { webkey } = await (await vault.get('report.txt')).share();
    expect(webkey).toMatch(/^file:[a-z2-7]{26}$/);

    const { kind, file } = await gate.open(webkey);
    expect(kind).toBe('file');
    expect(text(await file.read(3, 7))).toBe('revenue');
  });

  it('grants reading that one file and nothing else', async () => {
    const { gate, vault } = await makeOwner();
    const { webkey } = await (await vault.get('report.txt')).share();
    const opened = await gate.open(webkey);
    expect(Object.keys(opened).sort()).toEqual(['file', 'kind']);
    expect(Object.keys(opened.file).sort()).toEqual([
      'read',
      'revoke',
      'share',
      'shares',
      'stat',
    ]);
  });

  it('stops working when revoked, even for a reader already holding it', async () => {
    const { gate, vault } = await makeOwner();
    const owned = await vault.get('report.txt');
    const { webkey, shareId } = await owned.share();
    const { file } = await gate.open(webkey);
    await file.read(0, 4);

    await owned.revoke(shareId);

    await expect(file.read(0, 4)).rejects.toThrow('capability revoked');
    await expect(gate.open(webkey)).rejects.toThrow('capability revoked');
    expect(await owned.shares()).toEqual([
      expect.objectContaining({ shareId, revoked: true }),
    ]);
  });

  it('expires after its time to live', async () => {
    const { gate, vault, clock } = await makeOwner();
    const { webkey } = await (
      await vault.get('report.txt')
    ).share({ ttlMs: 60_000 });
    const { file } = await gate.open(webkey);
    clock.advance(59_999);
    await file.stat();
    clock.advance(1);
    await expect(file.stat()).rejects.toThrow('capability expired');
  });

  it('can be shared onward, and the onward share dies with it', async () => {
    const { gate, vault } = await makeOwner();
    const owned = await vault.get('report.txt');
    const first = await owned.share();
    const reader = (await gate.open(first.webkey)).file;
    const second = await reader.share();
    const onward = (await gate.open(second.webkey)).file;
    expect(text(await onward.read(0, 2))).toBe('Q3');

    await owned.revoke(first.shareId);

    await expect(onward.read(0, 2)).rejects.toThrow('capability revoked');
  });

  it('cannot revoke shares it did not make', async () => {
    const { gate, vault } = await makeOwner();
    const owned = await vault.get('report.txt');
    const alice = await owned.share();
    const bob = await owned.share();
    const alices = (await gate.open(alice.webkey)).file;

    await expect(alices.revoke(bob.shareId)).rejects.toThrow(
      'not a share of this file',
    );
    expect(await alices.shares()).toEqual([]);
    await gate.open(bob.webkey);
  });

  it('keeps serving the bytes it was shared with after a replacement', async () => {
    const { gate, vault } = await makeOwner();
    const { webkey } = await (await vault.get('report.txt')).share();
    await vault.put('report.txt', utf8('v2'), 'text/plain');
    const { file } = await gate.open(webkey);
    expect(text(await file.read(0, 2))).toBe('Q3');
  });

  it('is revoked when its file is removed from the vault', async () => {
    const { gate, vault } = await makeOwner();
    const { webkey } = await (await vault.get('report.txt')).share();
    await vault.remove('report.txt');
    expect(await vault.list()).toEqual([]);
    await expect(gate.open(webkey)).rejects.toThrow('capability revoked');
  });
});
