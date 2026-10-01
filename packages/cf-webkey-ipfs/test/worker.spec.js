import { env, exports } from 'cloudflare:workers';
import { abortAllDurableObjects, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { newWebSocketRpcSession } from 'capnweb';
import { makeSecretTools } from '../src/secrets.js';
import {
  getRandomValues,
  includesBytes,
  subtle,
  text,
  utf8,
} from './support.js';

/** A fresh Cap'n Web session with the Worker, as a browser tab would open. */
const openSession = async () => {
  const res = await exports.default.fetch(
    new Request('https://worker.test/api', {
      headers: { Upgrade: 'websocket' },
    }),
  );
  expect(res.status).toBe(101);
  res.webSocket.accept();
  return newWebSocketRpcSession(res.webSocket);
};

const SECRET_PLAN = utf8('launch is on the 14th '.repeat(40_000));

describe('the Worker', () => {
  it('serves only /api', async () => {
    const res = await exports.default.fetch(
      new Request('https://worker.test/x'),
    );
    expect(res.status).toBe(404);
  });

  it('shares a file across sessions and revokes it', async () => {
    const owner = await openSession();
    const { webkey: vaultKey } = await owner.createVault();
    const { vault } = await owner.open(vaultKey);
    await vault.put('plan.txt', SECRET_PLAN, 'text/plain');
    const { webkey, shareId } = await vault.get('plan.txt').share();

    const guest = await openSession();
    const { file } = await guest.open(webkey);
    expect(await file.stat()).toEqual({
      name: 'plan.txt',
      type: 'text/plain',
      size: SECRET_PLAN.length,
    });
    const middle = 300_000;
    expect(text(await file.read(middle, 22))).toBe(
      text(SECRET_PLAN.subarray(middle, middle + 22)),
    );

    await vault.get('plan.txt').revoke(shareId);
    await expect(file.read(0, 22)).rejects.toThrow('capability revoked');
    await expect((await openSession()).open(webkey)).rejects.toThrow(
      'capability revoked',
    );
  });

  it('reads in one round trip by pipelining on the opened capability', async () => {
    const owner = await openSession();
    const { webkey: vaultKey } = await owner.createVault();
    await owner
      .open(vaultKey)
      .vault.put('a.txt', utf8('pipelined'), 'text/plain');
    const guest = await openSession();
    const bytes = await guest.open(vaultKey).vault.get('a.txt').read(0, 9);
    expect(text(bytes)).toBe('pipelined');
  });

  it('refuses secrets it never minted', async () => {
    const session = await openSession();
    await expect(session.open(`vault:${'a'.repeat(26)}`)).rejects.toThrow(
      'no such capability',
    );
    await expect(session.open('vault:short')).rejects.toThrow(
      'malformed web-key secret',
    );
  });

  it('still honors a web-key after the Durable Object restarts', async () => {
    const owner = await openSession();
    const { webkey: vaultKey } = await owner.createVault();
    await owner
      .open(vaultKey)
      .vault.put('a.txt', utf8('durable'), 'text/plain');

    await abortAllDurableObjects();

    const later = await openSession();
    const bytes = await later.open(vaultKey).vault.get('a.txt').read(0, 7);
    expect(text(bytes)).toBe('durable');
  });

  it('keeps secrets, names and content out of its database', async () => {
    const owner = await openSession();
    const { webkey: vaultKey } = await owner.createVault();
    const { vault } = await owner.open(vaultKey);
    await vault.put('plan.txt', SECRET_PLAN, 'text/plain');
    const { webkey } = await vault.get('plan.txt').share();

    const dump = await runInDurableObject(
      env.VAULT_HOST.getByName('main'),
      (_instance, state) =>
        state.storage.sql
          .exec('SELECT * FROM caps')
          .toArray()
          .map(row => ({
            ...row,
            sealed: new Uint8Array(row.sealed),
            note: row.note && new Uint8Array(row.note),
          })),
    );
    expect(dump.length).toBeGreaterThanOrEqual(2);
    for (const row of dump) {
      const clear = utf8(JSON.stringify({ ...row, sealed: null, note: null }));
      for (const bytes of [clear, row.sealed, row.note ?? new Uint8Array()]) {
        for (const leak of [
          vaultKey.split(':')[1],
          webkey.split(':')[1],
          'plan.txt',
          'launch',
        ]) {
          expect(includesBytes(bytes, utf8(leak))).toBe(false);
        }
      }
    }
  });

  it('puts only ciphertext on IPFS', async () => {
    const owner = await openSession();
    const { webkey: vaultKey } = await owner.createVault();
    const { vault } = await owner.open(vaultKey);
    await vault.put('plan.txt', SECRET_PLAN, 'text/plain');

    // Recover the manifest CID the way only a holder of the secret can.
    const secrets = makeSecretTools({ subtle, getRandomValues });
    const { id, wrapKey } = await secrets.derive(vaultKey);
    const sealed = await runInDurableObject(
      env.VAULT_HOST.getByName('main'),
      (_instance, state) =>
        new Uint8Array(
          state.storage.sql
            .exec('SELECT sealed FROM caps WHERE id = ?', id)
            .one().sealed,
        ),
    );
    const [{ cid }] = (await secrets.unseal(wrapKey, sealed)).files;

    const res = await fetch(`${env.IPFS_GATEWAY}/ipfs/${cid}?format=raw`);
    expect(res.status).toBe(200);
    const block = new Uint8Array(await res.arrayBuffer());
    expect(block.length).toBeGreaterThan(0);
    expect(includesBytes(block, utf8('bafkrei'))).toBe(false);
    expect(includesBytes(block, utf8('launch'))).toBe(false);
  });
});
