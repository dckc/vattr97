/** @file toybox's entrypoints: the ingress (`Public`), the boot vat's own socket (`App`), and the admin socket (`Admin`), in front of {@link Kernel}s; and the {@link Directory} of ingress mounts. */
import '@endo/init';
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { mergeLabels } from './labels.js';
import {
  LOOKUP,
  MOUNT,
  MOUNT_LABELS,
  MOUNT_SCHEMA,
  OVERLAP,
  UNMOUNT,
  UNMOUNT_LABELS,
} from './mounts-sql.js';

export { Kernel, Syscall } from './kernel.js';

/** @import { HttpResponse, IngressKey } from './types.js' */

/**
 * The http socket's pages run no scripts: its mounts share one origin, so
 * a script on one vat's page could read what another's page keeps.
 */
const PUBLIC_POLICY = "script-src 'none'";

/** The app socket is the boot vat's alone, on an origin of its own: its pages' scripts come from it. */
const APP_POLICY =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";

/** A mount, as the Directory finds it: the ingress key it leads to, and its labels. @typedef {{ vat: IngressKey, labels: Record<string, string> }} Mount */

/**
 * Mounts: which vat serves which label set. One instance, by name.
 *
 * Registration follows Flower: a mount must conflict with every other, so
 * no request can carry two mounts' labels. Lookup is stricter than
 * Flower's: the request must carry all of a mount's labels.
 */
/** @extends {DurableObject<Env>} */
export class Directory extends DurableObject {
  /** @param {DurableObjectState} ctx @param {Env} env */
  constructor(ctx, env) {
    super(ctx, env);
    for (const statement of MOUNT_SCHEMA) ctx.storage.sql.exec(statement);
  }

  /**
   * Mount `vat` at `labels`, replacing its mount; `null` unmounts it.
   *
   * @param {IngressKey} vat
   * @param {Record<string, string> | null} labels
   */
  mount(vat, labels) {
    const { sql } = this.ctx.storage;
    this.ctx.storage.transactionSync(() => {
      sql.exec(UNMOUNT_LABELS, vat);
      if (!labels) return void sql.exec(UNMOUNT, vat);
      const json = JSON.stringify(labels);
      if (sql.exec(OVERLAP, json, vat).toArray().length) {
        throw new Error(
          'mount overlaps another: add a label whose value tells them apart',
        );
      }
      sql.exec(MOUNT, vat, json);
      sql.exec(MOUNT_LABELS, vat, json);
    });
  }

  /**
   * The mount whose labels `request` carries, if any. Registration keeps
   * mounts pairwise conflicting, so at most one can match.
   *
   * @param {Record<string, string>} request
   * @returns {Mount | null}
   */
  lookup(request) {
    const [row] = this.ctx.storage.sql
      .exec(LOOKUP, JSON.stringify(request))
      .toArray();
    return row
      ? {
          vat: /** @type {IngressKey} TEXT */ (row.vat),
          labels: JSON.parse(/** @type {string} TEXT */ (row.labels)),
        }
      : null;
  }
}

/**
 * A request's labels: its query parameters.
 *
 * Routing carries no secrets: a URL ends up in logs and `Referer`s. A
 * secret travels in-band instead, as on a webkey page: the page keeps it
 * in its fragment, reaches the vat by public labels, and sends it in the
 * body of a call, which the vat checks like a swissnum.
 *
 * @param {Request} request
 */
const requestLabels = request => {
  /** @type {Record<string, string>} */
  const labels = {};
  for (const [k, v] of new URL(request.url).searchParams) {
    if (k in labels) throw new Error(`label ${k} given twice`);
    labels[k] = v;
  }
  return Object.freeze(labels);
};

/**
 * The http socket: the ingress. A request reaches the handler served at
 * the mount whose labels it carries, which sees the mount's and the
 * request's labels together, as a Flower server gets its connection labels.
 */
/** @extends {WorkerEntrypoint<Env>} */
export class Public extends WorkerEntrypoint {
  /** @param {Request} request */
  async fetch(request) {
    let labels;
    try {
      labels = requestLabels(request);
    } catch (e) {
      return new Response(`bad labels: ${/** @type {Error} */ (e).message}\n`, {
        status: 400,
      });
    }
    const mount =
      await this.env.DIRECTORY.getByName('directory').lookup(labels);
    if (!mount) return new Response('nothing mounted here\n', { status: 404 });
    return this.#serveKernel(mount, labels, request);
  }

  /**
   * A mount made by a kernel's `makeIngress`: the request goes, as data,
   * to whoever serves it, through that kernel.
   *
   * @param {Mount} mount
   * @param {Record<string, string>} labels
   * @param {Request} request
   */
  async #serveKernel(mount, labels, request) {
    const req = await requestData(mergeLabels(mount.labels, labels), request);
    const [, id] = mount.vat.split(':');
    return responseFrom(
      await this.env.KERNEL.get(this.env.KERNEL.idFromString(id)).serveHttp(
        mount.vat,
        req,
      ),
      PUBLIC_POLICY,
    );
  }
}

/**
 * The app socket: every request goes to the boot vat of the kernel named
 * `main`, started on the first one (see {@link Kernel.boot}), for whoever
 * it has serve the socket. Its origin is its own, so its pages may keep
 * secrets in the browser's storage and run their own scripts.
 */
/** @extends {WorkerEntrypoint<Env>} */
export class App extends WorkerEntrypoint {
  /** @param {Request} request */
  async fetch(request) {
    let labels;
    try {
      labels = requestLabels(request);
    } catch (e) {
      return new Response(`bad labels: ${/** @type {Error} */ (e).message}\n`, {
        status: 400,
      });
    }
    return responseFrom(
      await this.env.KERNEL.getByName('main').serveApp(
        await requestData(labels, request),
      ),
      APP_POLICY,
    );
  }
}

/**
 * A request to an ingress, as passable data.
 *
 * @param {Record<string, string>} labels
 * @param {Request} request
 */
const requestData = async (labels, request) => {
  const { pathname } = new URL(request.url);
  const body = ['GET', 'HEAD'].includes(request.method)
    ? ''
    : await request.text();
  return { method: request.method, path: pathname, labels, body };
};

/** Statuses whose response has no body; a Response with one, even empty, throws. */
const NULL_BODY = [101, 103, 204, 205, 304];

/**
 * A handler's answer, as data, or `null`, as an HTTP response, under the
 * socket's content security policy.
 *
 * @param {HttpResponse | null} res
 * @param {string} policy
 */
const responseFrom = (res, policy) => {
  if (!res)
    return new Response('mounted, but nothing serves it now\n', {
      status: 503,
    });
  const status = res.status ?? 200;
  const resp = new Response(
    NULL_BODY.includes(status) ? null : (res.body ?? ''),
    {
      status,
      headers: res.headers ?? {},
    },
  );
  resp.headers.set('Referrer-Policy', 'no-referrer');
  resp.headers.set('Content-Security-Policy', policy);
  return resp;
};

/**
 * The admin socket: a WebSocket upgrade to `/kernel/<name>` reaches that
 * {@link Kernel}, whose session can make vats, devices, and ingresses.
 */
/** @extends {WorkerEntrypoint<Env>} */
export class Admin extends WorkerEntrypoint {
  /** @param {Request} request */
  async fetch(request) {
    const [, kernel, name] = new URL(request.url).pathname.split('/');
    if (
      request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' ||
      kernel !== 'kernel' ||
      !name
    )
      return new Response('a WebSocket to /kernel/<name>, please\n', {
        status: 400,
      });
    return this.env.KERNEL.getByName(name).fetch(request);
  }
}

export default Public;
