// @ts-check
/**
 * @file Drive a running Worker and Kubo node the way two browsers would:
 * an owner stores and shares a file, a guest reads it by web-key, the owner
 * revokes. Start both first with `yarn dev:all`.
 *
 * Usage: node scripts/e2e.js [workerOrigin] [kuboApiOrigin]
 */
import assert from 'node:assert/strict';
import { newWebSocketRpcSession } from 'capnweb';

const PLAIN = 'attack at dawn; tell no one. '.repeat(20_000);

/**
 * @param {() => PromiseLike<unknown>} attempt
 * @param {RegExp} reason
 */
const refused = (attempt, reason) =>
  assert.rejects(async () => {
    await attempt();
  }, reason);

/**
 * @param {string[]} args
 * @param {object} io
 * @param {typeof fetch} io.fetch
 * @param {(url: string) => any} io.connect opens a Cap'n Web session
 * @param {(line: string) => void} io.log
 */
const main = async (args, { fetch, connect, log }) => {
  const [
    workerOrigin = 'http://127.0.0.1:8797',
    kuboApi = 'http://127.0.0.1:5781',
  ] = args;
  const api = `${workerOrigin.replace(/^http/, 'ws')}/api`;
  const plain = new TextEncoder().encode(PLAIN);

  const owner = connect(api);
  const { webkey: vaultKey } = await owner.createVault();
  log(`owner: created vault  ${workerOrigin}/#${vaultKey}`);
  const { vault } = await owner.open(vaultKey);
  await vault.put('orders.txt', plain, 'text/plain');
  log(`owner: stored orders.txt (${plain.length} bytes, encrypted, on IPFS)`);
  const { webkey, shareId } = await vault.get('orders.txt').share();
  log(`owner: shared it as    ${workerOrigin}/#${webkey}`);

  const guest = connect(api);
  const { file } = await guest.open(webkey);
  const { size } = await file.stat();
  const got = await file.read(0, size);
  assert.ok(Buffer.from(got).equals(plain));
  log(`guest: read ${got.length} bytes back through the web-key`);
  assert.equal(file.put, undefined);
  await refused(
    () => guest.open(`vault:${'a'.repeat(26)}`).vault.list(),
    /no such capability/,
  );
  log('guest: a guessed vault secret is refused');

  const refs = await fetch(`${kuboApi}/api/v0/refs/local`, { method: 'POST' });
  const cids = (await refs.text())
    .trim()
    .split('\n')
    .map(line => JSON.parse(line).Ref);
  assert.ok(cids.length >= Math.ceil(plain.length / (256 * 1024)) + 1);
  for (const cid of cids) {
    const res = await fetch(`${kuboApi}/api/v0/block/get?arg=${cid}`, {
      method: 'POST',
    });
    const block = Buffer.from(await res.arrayBuffer());
    assert.equal(block.includes('attack at dawn'), false);
    assert.equal(block.includes('orders.txt'), false);
  }
  log(`ipfs:  ${cids.length} blocks in the local node, none with plaintext`);

  await vault.get('orders.txt').revoke(shareId);
  await refused(() => file.read(0, 10), /capability revoked/);
  await refused(() => connect(api).open(webkey), /capability revoked/);
  log('owner: revoked the share; the guest is refused, mid-session and anew');

  const stillThere = await vault.get('orders.txt').read(0, 14);
  assert.equal(new TextDecoder().decode(stillThere), 'attack at dawn');
  log('owner: still reads the file');
  log('ok');
};

main(process.argv.slice(2), {
  fetch: globalThis.fetch,
  connect: url => newWebSocketRpcSession(url),
  log: line => console.log(line),
}).then(
  () => process.exit(0),
  err => {
    console.error(err);
    process.exit(1);
  },
);
