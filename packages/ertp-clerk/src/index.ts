/**
 * @file Worker entry: one ledger Durable Object, reached at `/api` by
 * OCapN over a Cap'n Web WebSocket session.
 *
 * The only module that touches ambient authority (clock, randomness).
 */
import '@endo/init';
import { DurableObject } from 'cloudflare:workers';
import { newWorkersRpcResponse } from 'capnweb';
import { asGuid } from '@vattr/ertp-books/src/index.js';
import { ensureGnuCashSchema } from '@vattr/ertp-books/src/index.js';
import { makeLedgerHost } from './ledger-ocapn.js';
import type { ByteGateway } from './ocapn-capnweb-netlayer.js';
import { makeLedger } from './ledger.js';
import { makeSqlDatabaseFromStorage } from './sql-adapter.js';

type Env = { LEDGER: DurableObjectNamespace<LedgerDurableObject> };

export class LedgerDurableObject extends DurableObject<Env> {
  readonly #gateway: Promise<ByteGateway>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = makeSqlDatabaseFromStorage(ctx.storage.sql);
    ensureGnuCashSchema(db, { allowTransactionStatements: false });
    const hex = () => crypto.randomUUID().replace(/-/g, '');
    const { swissnumTable } = makeLedger({
      db,
      makeGuid: () => asGuid(hex()),
      nowMs: () => Date.now(),
      makeSwissnum: () => hex() + hex(),
    });
    this.#gateway = makeLedgerHost(swissnumTable).then(host => host.gateway);
  }

  async fetch(request: Request): Promise<Response> {
    return newWorkersRpcResponse(request, await this.#gateway);
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
