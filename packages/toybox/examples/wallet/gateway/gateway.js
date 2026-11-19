/**
 * The wallet's gateway: it serves the app socket, and keeps an agent for
 * each client ({@link prepareAgentsKit}). A client's page holds one secret,
 * its agent's swiss number, and names everything else by pet name: a
 * call's target, the references among its arguments, and where its
 * answer's references go.
 */
import { isRef, prepareAgentsKit, save } from './agents.exo.js';
import { PAGE, SCRIPT } from './page.js';
import { prepareRegistry } from './registry.exo.js';

/**
 * @import { BuildRootObject, HttpRequest, HttpResponse, MapStore, Remote, SwissNum } from '../../../src/types.js';
 * @import { Agent, Host, Invitation } from './agents.exo.js';
 * @import { Registry } from './registry.exo.js';
 * @import { NameHubKit } from './name-hub.js';
 */

const { entries, fromEntries, keys } = Object;

/**
 * @typedef {object} Params
 * @property {Remote} ingress the app socket's
 * @property {Remote<{ swiss(): SwissNum }>} entropy for swiss numbers
 * @property {Record<string, Remote>} starters what every new host names
 */

/** @param {unknown} ref */
const ifaceOf = ref =>
  String(
    /** @type {{ [Symbol.toStringTag]?: unknown }} a remotable's tag */ (ref)[
      Symbol.toStringTag
    ],
  ).replace(/^Alleged: /, '');

/** @param {number} status @param {unknown} data @returns {HttpResponse} */
const json = (status, data) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
});

/**
 * `value`, a JSON array of strings from the page.
 *
 * @param {unknown} value
 * @param {string} what it is, for the error
 * @returns {string[]}
 */
const stringListOf = (value, what) => {
  if (!Array.isArray(value) || !value.every(v => typeof v === 'string'))
    throw Error(`${what} is an array of strings`);
  return value;
};

/** @typedef {ReturnType<typeof buildRootObject>} Gateway the gateway's root */

/** @satisfies {BuildRootObject<Params>} */
export const buildRootObject = (
  { E, Far, M, zone },
  { ingress, entropy, starters },
) => {
  /** @type {MapStore<'owner', Host>} the first client's host */
  const gateway = zone.mapStore('gateway');

  const agentsKit = prepareAgentsKit(zone.subZone('agents'), {
    Far,
    M,
    starters,
  });

  /** @type {() => Registry<Host | Invitation>} */
  const makeRegistry = prepareRegistry(zone.subZone('registry'), {
    E,
    M,
    entropy,
  });
  /** each agent's own facet, and each open invitation, by the swiss number in its link */
  const links = zone.makeOnce('links', () => makeRegistry());

  /**
   * The agent `swiss` keeps, if any.
   *
   * @param {unknown} swiss
   */
  const agentAt = swiss => agentsKit.agentOf(links.deref(swiss));

  /**
   * Accept the invitation `invite` keeps: as the host `kit`, or as a new
   * one, whose swiss number it answers.
   *
   * @param {unknown} invite
   * @param {Agent['kit']} [kit]
   */
  const accept = async (invite, kit) => {
    const made = await agentsKit.accept(links.deref(invite), kit);
    return {
      host: made.host && (await links.register(made.host)),
      inviter: made.inviter,
    };
  };

  /**
   * Arguments from the page: `{ "@name": n }` is the reference `n` names.
   *
   * @param {NameHubKit} names @param {unknown} arg
   * @returns {Promise<unknown>}
   */
  const fromPage = async (names, arg) => {
    if (Array.isArray(arg))
      return Promise.all(arg.map(a => fromPage(names, a)));
    if (typeof arg !== 'object' || arg === null) return arg;
    const { '@name': name, ...rest } = /** @type {Record<string, unknown>} */ (
      arg
    );
    if (typeof name === 'string' && !keys(rest).length)
      return names.nameHub.lookup(name);
    return fromEntries(
      await Promise.all(
        entries(arg).map(async ([k, v]) => [k, await fromPage(names, v)]),
      ),
    );
  };

  /**
   * An answer, for the page: each reference in it saved in `names`, as
   * `saveAs`, or `saveAs.<key>` within records and arrays, and shown as
   * `{ "@name": ... }`.
   *
   * @param {NameHubKit} names @param {unknown} value @param {string} [saveAs]
   * @returns {unknown}
   */
  const toPage = (names, value, saveAs) => {
    if (isRef(value)) {
      if (!saveAs)
        throw Error('the answer holds a reference: name it with saveAs');
      save(names, saveAs, value);
      return { '@name': saveAs };
    }
    if (Array.isArray(value))
      return value.map((v, i) => toPage(names, v, saveAs && `${saveAs}.${i}`));
    if (typeof value === 'object' && value !== null)
      return fromEntries(
        entries(value).map(([k, v]) => [
          k,
          toPage(names, v, saveAs && `${saveAs}.${k}`),
        ]),
      );
    if (typeof value === 'bigint') return `${value}`;
    return value ?? null;
  };

  /**
   * What the page asks of its agent, by `op`. The request is JSON the page
   * posted, so every field is `unknown` here; each use checks or coerces
   * it, and nothing untyped runs further than this switch.
   *
   * @param {Agent} agent
   * @param {Record<string, unknown>} req
   */
  const operate = async (agent, req) => {
    const own = agent.kit.host;
    const names = own.names();
    switch (String(req.op)) {
      case 'view':
        return {
          label: agent.kit.receiver.label(),
          kind: agent.kind,
          names: names.nameHub
            .entries()
            .map(([name, ref]) => ({ name, iface: ifaceOf(ref) })),
          messages: own.listMessages(),
        };
      case 'call': {
        const args = await fromPage(names, req.args ?? []);
        if (!Array.isArray(args)) throw Error('args is an array');
        const saveAs = typeof req.saveAs === 'string' ? req.saveAs : undefined;
        const answer = await E(names.nameHub.lookup(String(req.target)))[
          String(req.method)
        ](...harden(args));
        return { answer: toPage(names, answer, saveAs) };
      }
      case 'send':
        await own.send(
          String(req.to),
          stringListOf(req.strings, 'strings'),
          stringListOf(req.edgeNames, 'edgeNames'),
          stringListOf(req.petNames, 'petNames'),
        );
        return {};
      case 'adopt':
        own.adopt(
          Number(req.number),
          String(req.edgeName),
          String(req.petName),
        );
        return {};
      case 'dismiss':
        own.dismiss(Number(req.number));
        return {};
      case 'forget': {
        const name = String(req.name);
        if (!names.nameHub.has(name))
          throw Error(`no ${JSON.stringify(name)} here`);
        names.nameAdmin.delete(name);
        return {};
      }
      case 'invite':
        return {
          invite: await links.register(own.invite(String(req.peer))),
        };
      default:
        throw Error(`no such op: ${req.op}`);
    }
  };

  /** @param {string} body */
  const api = async body => {
    const req =
      /** @type {Record<string, unknown>} the page's JSON, untyped until narrowed below */ (
        JSON.parse(body)
      );
    const agent = req.agent === undefined ? undefined : agentAt(req.agent);
    if (req.agent !== undefined && !agent) throw Error('no such agent');
    if (String(req.op) === 'accept') return accept(req.invite, agent?.kit);
    if (!agent) throw Error('no agent');
    return operate(agent, req);
  };

  const makeHandler = zone.exoClass('Handler', undefined, () => ({}), {
    /** @param {HttpRequest} request */
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

  /** The agents, by the swiss numbers in their links. */
  const agentsFacet = zone.exo('Agents', undefined, {
    /**
     * The agent a swiss number keeps, as the page reaches it with that
     * link: its NameHub, its NameAdmin, and its own facet, `host`; it
     * throws for a swiss number that keeps none. OCapN's
     * bootstrap object calls this `fetch`.
     *
     * @see https://github.com/ocapn/ocapn/blob/main/draft-specifications/CapTP%20Specification.md#fetch-method
     * @param {SwissNum} swiss
     */
    deref(swiss) {
      const agent = agentAt(swiss);
      if (!agent) throw Error('no such agent');
      return harden({ ...agent.kit.host.names(), host: agent.kit.host });
    },
  });

  /** The open invitations, by the swiss numbers in their links. */
  const invitesFacet = zone.exo('Invites', undefined, {
    /**
     * Accept the invitation `invite`, as a new host: its swiss number, and
     * the name it knows the inviter by. Whoever holds an invitation can,
     * as with the page.
     *
     * @param {SwissNum} invite
     * @returns {Promise<{ host: SwissNum, inviter: string }>}
     */
    async accept(invite) {
      const { host, inviter } = await accept(invite);
      if (host === undefined) throw Error('accepted as no new host');
      return { host, inviter };
    },
  });

  return Far('gateway', {
    /** The first client's host, as a link fragment: whoever holds it is that client. */
    async provideOwnerLink() {
      if (!gateway.has('owner'))
        gateway.init('owner', agentsKit.newHost('owner').host);
      return `#agent=${await links.register(gateway.get('owner'))}`;
    },
    agents: () => agentsFacet,
    invites: () => invitesFacet,
  });
};
