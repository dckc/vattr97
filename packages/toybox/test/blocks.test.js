/** @file The blocks page's statements, run against a page API that records what it's asked. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  methodChoices,
  runStatement,
  statementText,
} from '../examples/wallet/gateway/blocks.js';

/**
 * A page API that answers each `call` from `answers`, by method, and
 * records every request.
 *
 * @param {Record<string, unknown>} answers
 */
const makeApi = answers => {
  /** @type {Record<string, unknown>[]} */
  const asked = [];
  /** @param {Record<string, unknown>} req */
  const api = async req => {
    asked.push(req);
    if (req.op !== 'call') return {};
    const answer = answers[String(req.method)];
    return {
      answer:
        answer === 'ref'
          ? { '@name': /** @type {string} */ (req.saveAs) }
          : answer,
    };
  };
  let n = 0;
  return { api, asked, fresh: () => `_t${(n += 1)}` };
};

test('a nested call is a call per round trip, its reference saved under a fresh name and forgotten after', async () => {
  const { api, asked, fresh } = makeApi({
    get: 'ref',
    withdraw: 'ref',
    buy: 'ref',
  });
  const answer = await runStatement(
    api,
    {
      save: 'widget',
      expr: {
        call: {
          target: {
            call: {
              target: { pet: 'board' },
              method: 'get',
              args: [{ lit: 'bobs-shop' }],
            },
          },
          method: 'buy',
          args: [
            {
              call: {
                target: { pet: 'wallet' },
                method: 'withdraw',
                args: [{ lit: 3 }],
              },
            },
          ],
        },
      },
    },
    fresh,
  );
  assert.deepEqual(answer, { '@name': 'widget' });
  assert.deepEqual(asked, [
    {
      op: 'call',
      target: 'board',
      method: 'get',
      args: ['bobs-shop'],
      saveAs: '_t1',
    },
    {
      op: 'call',
      target: 'wallet',
      method: 'withdraw',
      args: [3],
      saveAs: '_t2',
    },
    {
      op: 'call',
      target: '_t1',
      method: 'buy',
      args: [{ '@name': '_t2' }],
      saveAs: 'widget',
    },
    { op: 'forget', name: '_t1' },
    { op: 'forget', name: '_t2' },
  ]);
});

test('a nested answer that is data goes in as data, and nothing is left to forget', async () => {
  const { api, asked, fresh } = makeApi({ read: 2, incr: 3 });
  const answer = await runStatement(
    api,
    {
      save: 'n',
      expr: {
        call: {
          target: { pet: 'c' },
          method: 'incr',
          args: [{ call: { target: { pet: 'c' }, method: 'read', args: [] } }],
        },
      },
    },
    fresh,
  );
  assert.equal(answer, 3);
  assert.deepEqual(asked.at(-1), {
    op: 'call',
    target: 'c',
    method: 'incr',
    args: [2],
    saveAs: 'n',
  });
  assert.equal(asked.filter(r => r.op === 'forget').length, 0);
});

test('a call on data is refused before anything is asked of it', async () => {
  const { api, asked, fresh } = makeApi({ read: 2 });
  await assert.rejects(
    runStatement(
      api,
      {
        save: 'x',
        expr: {
          call: {
            target: {
              call: { target: { pet: 'c' }, method: 'read', args: [] },
            },
            method: 'incr',
            args: [],
          },
        },
      },
      fresh,
    ),
    /incr: the target is data/,
  );
  assert.deepEqual(
    asked.map(r => r.method),
    ['read'],
  );
});

test('endowing names a definition and its slots', async () => {
  const { api, asked, fresh } = makeApi({});
  await runStatement(
    api,
    { endow: 3, bindings: { counter: 'c' }, saveAs: 'twice' },
    fresh,
  );
  assert.deepEqual(asked, [
    { op: 'endow', number: 3, bindings: { counter: 'c' }, saveAs: 'twice' },
  ]);
});

test('the pegboard reads as text: saves as assignments, calls in E() form, endowments by slot', () => {
  assert.equal(
    statementText({
      save: 'widget',
      expr: {
        call: {
          target: { pet: 'shop' },
          method: 'buy',
          args: [
            {
              call: {
                target: { pet: 'wallet' },
                method: 'withdraw',
                args: [{ lit: 3 }],
              },
            },
            { lit: 'blue' },
          ],
        },
      },
    }),
    'widget = E(shop).buy(E(wallet).withdraw(3), "blue")',
  );
  assert.equal(
    statementText({
      endow: 2,
      bindings: { testnet: 'testnet', signer: 's1' },
      saveAs: 'ertp',
    }),
    'ertp = endow(#2, { testnet, signer: s1 })',
  );
});

test('a call block offers the methods a caller would choose, sorted', () => {
  assert.deepEqual(
    methodChoices(['withdraw', '__getMethodNames__', 'deposit', 3]),
    ['deposit', 'withdraw'],
  );
  assert.deepEqual(methodChoices({ not: 'a list' }), []);
});
