/**
 * The wallet's gateway: it serves the app socket, and keeps a NameHub for
 * each client. A client's page holds one secret, its hub's swiss number,
 * and names everything else by petname in its hub: a call's target, the
 * references among its arguments, and where its answer's references go.
 *
 * Hubs meet by invitation: a hub's `invite(peer)` makes a one-time swiss
 * number; whoever accepts it, with a hub of their own or a new one, gets a
 * mailbox to the inviter, and the inviter one to them. A mailbox delivers
 * to its owner's inbox, labelled with the name its owner knows the sender
 * by, so no sender can pass as another.
 */
import { PAGE, SCRIPT } from './page.js';

/** @import { BuildRootObject, HttpRequest, HttpResponse, MapStore, Remote } from '../../../types.js' */

const { entries, fromEntries, getPrototypeOf, keys } = Object;

/**
 * @typedef {object} Params
 * @property {Remote} ingress the app socket's
 * @property {Remote} entropy for swiss numbers
 * @property {Record<string, Remote>} starters what every new hub names
 */

/** @typedef {{ from: string, label: string, refs: unknown[] }} Message */

/**
 * Whether `value` is a reference, not data: a remotable, local or a
 * presence. Copied records and arrays have the plain prototypes.
 *
 * @param {unknown} value
 */
const isRef = value =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  getPrototypeOf(value) !== Object.prototype;

/** @param {unknown} ref */
const ifaceOf = ref =>
  String(
    /** @type {any} a remotable's tag */ (ref)[Symbol.toStringTag],
  ).replace(/^Alleged: /, '');

/** @param {number} status @param {unknown} data @returns {HttpResponse} */
const json = (status, data) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
});

/** @type {BuildRootObject<Params>} */
export const buildRootObject = (
  { E, Far, zone },
  { ingress, entropy, starters },
) => {
  /** @type {MapStore<string, any>} each hub kit, by its swiss number */
  const hubs = zone.mapStore('hubs');
  /** @type {MapStore<string, { inviter: any, peer: string }>} each open invitation, by its swiss number */
  const invites = zone.mapStore('invites');
  /** @type {MapStore<string, string>} */
  const gateway = zone.mapStore('gateway');

  const makeMailbox = zone.exoClass(
    'Mailbox',
    undefined,
    (/** @type {any} */ receiver, /** @type {string} */ from) => ({
      receiver,
      from,
    }),
    {
      /** @param {string} label @param {unknown[]} refs */
      deliver(label, refs) {
        this.state.receiver.receive(this.state.from, label, refs);
      },
    },
  );

  const makeHub = zone.exoClassKit(
    'Hub',
    undefined,
    (/** @type {string} */ label) => ({
      label,
      names: zone.detached().mapStore('names'),
      inbox: zone.detached().mapStore('inbox'),
      nextMessage: 1,
    }),
    {
      hub: {
        /** @param {string} name */
        lookup(name) {
          const { names } = this.state;
          if (!names.has(name)) throw Error(`no ${JSON.stringify(name)} here`);
          return names.get(name);
        },
        /** @param {string} name @param {unknown} ref */
        save(name, ref) {
          const { names } = this.state;
          if (!name) throw Error('a name, please');
          if (names.has(name)) names.set(name, ref);
          else names.init(name, ref);
        },
        /** A name not yet taken: `base`, or `base-2`, `base-3`, … @param {string} base */
        fresh(base) {
          const { names } = this.state;
          let name = base;
          for (let n = 2; names.has(name); n += 1) name = `${base}-${n}`;
          return name;
        },
        /** @param {string} name */
        forget(name) {
          this.facets.hub.lookup(name);
          this.state.names.delete(name);
        },
        /** What the page shows: this hub's label, names, and messages. */
        view() {
          const { label, names, inbox } = this.state;
          return {
            label,
            names: /** @type {[string, unknown][]} */ (names.entries()).map(
              ([name, ref]) => ({ name, iface: ifaceOf(ref) }),
            ),
            messages: /** @type {[number, Message][]} */ (inbox.entries())
              .sort(([a], [b]) => a - b)
              .map(([id, { from, label: what, refs }]) => ({
                id,
                from,
                label: what,
                count: refs.length,
              })),
          };
        },
        /** Name the `index`th reference of message `id` as `name`. @param {number} id @param {number} index @param {string} name */
        adopt(id, index, name) {
          const { refs } = /** @type {Message} */ (this.state.inbox.get(id));
          if (!Number.isInteger(index) || index < 0 || index >= refs.length)
            throw Error(`message ${id} has no ${index}`);
          this.facets.hub.save(name, refs[index]);
        },
        /** @param {number} id */
        dismiss(id) {
          this.state.inbox.delete(id);
        },
        /** Send the references named `names` to whoever `to` names. @param {string} to @param {string} label @param {string[]} names */
        async send(to, label, names) {
          const { hub } = this.facets;
          const refs = names.map(name => hub.lookup(name));
          await E(hub.lookup(to)).deliver(label, harden(refs));
        },
      },
      receiver: {
        /** @param {string} from @param {string} label @param {unknown[]} refs */
        receive(from, label, refs) {
          const id = this.state.nextMessage;
          this.state.nextMessage += 1;
          this.state.inbox.init(id, harden({ from, label, refs }));
        },
      },
    },
  );

  /** A new hub, naming the starters, kept under a new swiss number. @param {string} label */
  const newHub = async label => {
    const kit = makeHub(label);
    for (const [name, ref] of entries(starters)) kit.hub.save(name, ref);
    const swiss = await E(entropy).swiss();
    hubs.init(swiss, kit);
    return { swiss, kit };
  };

  /**
   * Give each of two hubs a mailbox to the other: `a` names `b` as
   * `bName` (or the next free name), and `b` names `a` by its label.
   *
   * @param {any} a @param {string} bName @param {any} b
   */
  const introduce = (a, bName, b) => {
    const aCallsB = a.hub.fresh(bName);
    const bCallsA = b.hub.fresh(a.hub.view().label);
    a.hub.save(aCallsB, makeMailbox(b.receiver, bCallsA));
    b.hub.save(bCallsA, makeMailbox(a.receiver, aCallsB));
    return { aCallsB, bCallsA };
  };

  /**
   * Arguments from the page: `{ "@name": n }` is the reference `n` names.
   *
   * @param {any} hub @param {unknown} arg
   * @returns {unknown}
   */
  const fromPage = (hub, arg) => {
    if (Array.isArray(arg)) return arg.map(a => fromPage(hub, a));
    if (typeof arg !== 'object' || arg === null) return arg;
    const { '@name': name, ...rest } = /** @type {Record<string, unknown>} */ (
      arg
    );
    if (typeof name === 'string' && !keys(rest).length) return hub.lookup(name);
    return fromEntries(entries(arg).map(([k, v]) => [k, fromPage(hub, v)]));
  };

  /**
   * An answer, for the page: each reference in it saved in the hub, as
   * `saveAs`, or `saveAs.<key>` within records and arrays, and shown as
   * `{ "@name": … }`.
   *
   * @param {any} hub @param {unknown} value @param {string} [saveAs]
   * @returns {unknown}
   */
  const toPage = (hub, value, saveAs) => {
    if (isRef(value)) {
      if (!saveAs)
        throw Error('the answer holds a reference: name it with saveAs');
      hub.save(saveAs, value);
      return { '@name': saveAs };
    }
    if (Array.isArray(value))
      return value.map((v, i) => toPage(hub, v, saveAs && `${saveAs}.${i}`));
    if (typeof value === 'object' && value !== null)
      return fromEntries(
        entries(value).map(([k, v]) => [
          k,
          toPage(hub, v, saveAs && `${saveAs}.${k}`),
        ]),
      );
    if (typeof value === 'bigint') return `${value}`;
    return value ?? null;
  };

  /**
   * What the page asks of its hub, by `op`.
   *
   * @param {any} kit
   * @param {Record<string, any>} req
   */
  const operate = async (kit, req) => {
    const { hub } = kit;
    switch (req.op) {
      case 'view':
        return hub.view();
      case 'call': {
        const args = fromPage(hub, req.args ?? []);
        if (!Array.isArray(args)) throw Error('args is an array');
        const answer = await E(hub.lookup(req.target))[req.method](
          ...harden(args),
        );
        return { answer: toPage(hub, answer, req.saveAs) };
      }
      case 'invite': {
        const swiss = await E(entropy).swiss();
        invites.init(swiss, harden({ inviter: kit, peer: String(req.peer) }));
        return { invite: swiss };
      }
      case 'send':
        await hub.send(req.to, String(req.label ?? ''), req.names ?? []);
        return {};
      case 'adopt':
        hub.adopt(req.id, req.index, req.name);
        return {};
      case 'dismiss':
        hub.dismiss(req.id);
        return {};
      case 'forget':
        hub.forget(req.name);
        return {};
      default:
        throw Error(`no such op: ${req.op}`);
    }
  };

  /**
   * Accept the invitation `invite`: as the hub `swiss`, or as a new one.
   *
   * @param {string} invite
   * @param {string} [swiss]
   */
  const accept = async (invite, swiss) => {
    if (!invites.has(invite)) throw Error('no such invitation, or it was used');
    const { inviter, peer } = invites.get(invite);
    invites.delete(invite);
    const made = swiss ? undefined : await newHub(peer);
    const kit = made ? made.kit : hubs.get(/** @type {string} */ (swiss));
    const { bCallsA } = introduce(inviter, peer, kit);
    return { hub: made?.swiss, inviter: bCallsA };
  };

  /** @param {string} body */
  const api = async body => {
    const req = JSON.parse(body);
    if (req.hub !== undefined && !hubs.has(req.hub)) throw Error('no such hub');
    if (req.op === 'accept') return accept(req.invite, req.hub);
    if (req.hub === undefined) throw Error('no hub');
    return operate(hubs.get(req.hub), req);
  };

  const makeHandler = zone.exoClass('Handler', undefined, () => ({}), {
    /** @param {HttpRequest} request @returns {Promise<HttpResponse>} */
    async handle({ method, path, body }) {
      if (method === 'GET' && path === '/')
        return {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: PAGE,
        };
      if (method === 'GET' && path === '/wallet.js')
        return {
          status: 200,
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
          body: SCRIPT,
        };
      if (method === 'POST' && path === '/api') {
        try {
          return json(200, await api(body));
        } catch (e) {
          return json(400, { error: /** @type {Error} */ (e).message });
        }
      }
      return { status: 404, body: 'not here\n' };
    },
  });
  zone.makeOnce('served', () => {
    const handler = makeHandler();
    E(ingress).serve(handler);
    return handler;
  });

  return Far('gateway', {
    /** The first client's hub, as a link fragment: whoever holds it is that client. */
    async ownerLink() {
      if (!gateway.has('owner'))
        gateway.init('owner', (await newHub('owner')).swiss);
      return `#hub=${gateway.get('owner')}`;
    },
  });
};
