import { describe, it, expect } from 'vitest';
import { makeSecretTools, parseSecret } from '../src/secrets.js';
import { getRandomValues, subtle } from './support.js';

const secrets = makeSecretTools({ subtle, getRandomValues });

describe('web-key secrets', () => {
  it('are kind-bearing with 128 bits of entropy', () => {
    const secret = secrets.mintSecret('file');
    expect(secret).toMatch(/^file:[a-z2-7]{26}$/);
    expect(parseSecret(secret).entropy.length).toBe(16);
    expect(secrets.mintSecret('file')).not.toBe(secret);
  });

  it('are rejected when malformed', () => {
    for (const bad of ['', 'file:', 'file:abc', 'FILE:' + 'a'.repeat(26), 7]) {
      expect(() => parseSecret(bad)).toThrow(TypeError);
    }
  });

  it('derive the same row id each time, unrelated to the secret text', async () => {
    const secret = secrets.mintSecret('vault');
    const a = await secrets.derive(secret);
    const b = await secrets.derive(secret);
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^[a-z2-7]{52}$/);
    expect(a.id).not.toContain(secret.split(':')[1]);
    expect((await secrets.derive(secrets.mintSecret('vault'))).id).not.toBe(
      a.id,
    );
  });

  it('derive a wrap key that cannot be exported', async () => {
    const { wrapKey } = await secrets.derive(secrets.mintSecret('vault'));
    expect(wrapKey.extractable).toBe(false);
  });
});

describe('sealing', () => {
  it('round-trips a payload under the wrap key', async () => {
    const { wrapKey } = await secrets.derive(secrets.mintSecret('file'));
    const sealed = await secrets.seal(wrapKey, { key: 'k', n: [1, 2] });
    expect(await secrets.unseal(wrapKey, sealed)).toEqual({
      key: 'k',
      n: [1, 2],
    });
  });

  it("cannot be opened with another secret's wrap key", async () => {
    const mine = await secrets.derive(secrets.mintSecret('file'));
    const theirs = await secrets.derive(secrets.mintSecret('file'));
    const sealed = await secrets.seal(mine.wrapKey, { key: 'k' });
    await expect(secrets.unseal(theirs.wrapKey, sealed)).rejects.toThrow();
  });
});
