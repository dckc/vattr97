import { describe, it, expect } from 'vitest';
import { includesBytes, makeTestService, utf8 } from './support.js';

describe('the ref table', () => {
  it('opens a minted secret and reads back its payload', async () => {
    const { refTable } = makeTestService();
    const { secret, id } = await refTable.mint({
      kind: 'vault',
      payload: { files: [] },
    });
    const holder = await refTable.open(secret);
    expect(holder.id).toBe(id);
    expect(holder.kind).toBe('vault');
    expect(await refTable.read(holder)).toEqual({ files: [] });
  });

  it('keeps neither the secret nor the payload in the clear', async () => {
    const { refTable, store } = makeTestService();
    const { secret } = await refTable.mint({
      kind: 'file',
      payload: { key: 'content-key-material' },
    });
    const [row] = [...store.rows.values()];
    const entropy = secret.split(':')[1];
    expect(row.id).not.toContain(entropy);
    expect(JSON.stringify({ ...row, sealed: undefined })).not.toContain(
      entropy,
    );
    expect(includesBytes(row.sealed, utf8(entropy))).toBe(false);
    expect(includesBytes(row.sealed, utf8('content-key-material'))).toBe(false);
  });

  it('refuses a well-formed secret that was never minted', async () => {
    const { refTable, secrets, store } = makeTestService();
    await expect(refTable.open(secrets.mintSecret('vault'))).rejects.toThrow(
      'no such capability',
    );
    expect(store.rows.size).toBe(0);
  });

  it('refuses a capability after it expires', async () => {
    const { refTable, clock } = makeTestService();
    const { secret } = await refTable.mint({
      kind: 'file',
      payload: {},
      expiresAt: clock.now() + 1000,
    });
    await refTable.open(secret);
    clock.advance(1000);
    await expect(refTable.open(secret)).rejects.toThrow('capability expired');
  });

  it('revokes a delegation and everything delegated from it', async () => {
    const { refTable } = makeTestService();
    const root = await refTable.mint({ kind: 'vault', payload: {} });
    const rootHolder = await refTable.open(root.secret);
    const child = await refTable.mint({
      kind: 'file',
      payload: {},
      parent: rootHolder,
    });
    const childHolder = await refTable.open(child.secret);
    const grandchild = await refTable.mint({
      kind: 'file',
      payload: {},
      parent: childHolder,
    });

    refTable.revokeChild(rootHolder, child.id);

    await expect(refTable.open(child.secret)).rejects.toThrow('revoked');
    await expect(refTable.open(grandchild.secret)).rejects.toThrow('revoked');
    await refTable.open(root.secret);
  });

  it('lets only the delegator revoke', async () => {
    const { refTable } = makeTestService();
    const root = await refTable.mint({ kind: 'vault', payload: {} });
    const rootHolder = await refTable.open(root.secret);
    const a = await refTable.mint({
      kind: 'file',
      payload: {},
      parent: rootHolder,
    });
    const b = await refTable.mint({
      kind: 'file',
      payload: {},
      parent: rootHolder,
    });
    const aHolder = await refTable.open(a.secret);

    expect(() => refTable.revokeChild(aHolder, b.id)).toThrow(
      'not a delegation of this capability',
    );
    expect(() => refTable.revokeChild(aHolder, root.id)).toThrow();
    await refTable.open(b.secret);
  });

  it('never lets a delegation outlive its parent', async () => {
    const { refTable, clock } = makeTestService();
    const root = await refTable.mint({
      kind: 'file',
      payload: {},
      expiresAt: clock.now() + 1000,
    });
    const child = await refTable.mint({
      kind: 'file',
      payload: {},
      parent: await refTable.open(root.secret),
      expiresAt: clock.now() + 5000,
    });
    expect(child.expiresAt).toBe(clock.now() + 1000);
  });

  it('shows a delegator its notes, sealed from everyone else', async () => {
    const { refTable, store } = makeTestService();
    const root = await refTable.mint({ kind: 'vault', payload: {} });
    const rootHolder = await refTable.open(root.secret);
    const child = await refTable.mint({
      kind: 'file',
      payload: {},
      parent: rootHolder,
      note: { name: 'payroll.csv' },
    });
    expect(await refTable.children(rootHolder)).toEqual([
      expect.objectContaining({
        id: child.id,
        note: { name: 'payroll.csv' },
        revoked: false,
      }),
    ]);
    const row = store.rows.get(child.id);
    expect(includesBytes(row.note, utf8('payroll'))).toBe(false);
  });

  it('applies concurrent updates one at a time', async () => {
    const { refTable } = makeTestService();
    const { secret } = await refTable.mint({
      kind: 'vault',
      payload: { n: [] },
    });
    const holder = await refTable.open(secret);
    await Promise.all(
      [1, 2, 3, 4, 5].map(i =>
        refTable.update(holder, payload => ({ n: [...payload.n, i] })),
      ),
    );
    expect((await refTable.read(holder)).n).toEqual([1, 2, 3, 4, 5]);
  });
});
