/**
 * @file Worker entry: a ledger Durable Object per name, reached at
 * `/api/<name>` (`/api` for the default ledger) by OCapN over a
 * Cap'n Web WebSocket session.
 *
 * The only module that touches ambient authority (clock, randomness).
 */
import '@endo/init';
import { DurableObject } from 'cloudflare:workers';
import { newWorkersRpcResponse } from 'capnweb';
import { asGuid } from '@vattr/ertp-books/src/index.js';
import { ensureGnuCashSchema } from '@vattr/ertp-books/src/index.js';
import { DEFAULT_LEDGER, makeLedgerHost } from './ledger-ocapn.js';
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
    const { name } = ctx.id;
    if (!name) throw Error('a ledger is reached by name');
    this.#gateway = makeLedgerHost(swissnumTable, name).then(
      host => host.gateway,
    );
  }

  async fetch(request: Request): Promise<Response> {
    return newWorkersRpcResponse(request, await this.#gateway);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const name =
      pathname === '/api'
        ? DEFAULT_LEDGER
        : pathname.match(/^\/api\/([a-z0-9-]+)$/)?.[1];
    if (name) {
      return env.LEDGER.get(env.LEDGER.idFromName(name)).fetch(request);
    }
    return new Response('not found', { status: 404 });
  },
};
