/**
 * @file Worker entry: one ledger Durable Object, reached at `/api` by
 * CapTP over a Cap'n Web WebSocket session.
 *
 * The only module that touches ambient authority (clock, randomness).
 */
import '@endo/init';
import { DurableObject } from 'cloudflare:workers';
import { newWorkersRpcResponse } from 'capnweb';
import { asGuid } from '@vattr/ertp-books/src/index.js';
import { ensureGnuCashSchema } from '@vattr/ertp-books/src/index.js';
import { Gateway } from './captp-over-capnweb.js';
import { makeLedgerBootstrap } from './ledger.js';
import { makeSqlDatabaseFromStorage } from './sql-adapter.js';

type Env = { LEDGER: DurableObjectNamespace<LedgerDurableObject> };

export class LedgerDurableObject extends DurableObject<Env> {
  readonly #bootstrap: object;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = makeSqlDatabaseFromStorage(ctx.storage.sql);
    ensureGnuCashSchema(db, { allowTransactionStatements: false });
    this.#bootstrap = makeLedgerBootstrap({
      db,
      makeGuid: () => asGuid(crypto.randomUUID().replace(/-/g, '')),
      nowMs: () => Date.now(),
    });
  }

  async fetch(request: Request): Promise<Response> {
    return newWorkersRpcResponse(
      request,
      new Gateway('ledger', this.#bootstrap, console.log),
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api') {
      return env.LEDGER.get(env.LEDGER.idFromName('default')).fetch(request);
    }
    return new Response('not found', { status: 404 });
  },
};
