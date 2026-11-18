/**
 * The wallet's gateway: it serves the app socket, and keeps an agent for
 * each client ({@link prepareAgentsKit}). A client's page holds one secret,
 * its agent's swiss number, and names everything else by pet name: a
 * call's target, the references among its arguments, and where its
 * answer's references go.
 */
import { isRef, prepareAgentsKit, save } from './agents.exo.js';
import { PAGE, SCRIPT } from './page.js';
import {
  LOADER,
  LOADER_SCRIPT,
  SERVED,
  pageRequestOf,
  postingBack,
} from './pages.js';
import { prepareRegistry } from './registry.exo.js';

/**
 * @import { BuildRootObject, HttpRequest, HttpResponse, MapStore, Remote, SwissNum } from '../../../src/types.js';
 * @import { Agent, Definer, Definition, Guest, Host, Invitation } from './agents.exo.js';
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

/**
 * What the boot vat equips the gateway with at each start: the definer,
 * and what the owner's host starts with, beyond the starters.
 *
 * @typedef {{ definer: Remote<Definer>, ownerStarters: Record<string, Remote> }} Equipment
 */

/** @typedef {{ handle(request: HttpRequest): HttpResponse | Promise<HttpResponse> }} PageHandler what a host serves at a page's link */

/**
 * `value`, a JSON object from the page, as a record.
 *
 * @param {unknown} value
 * @param {string} what it is, for the error
 * @returns {Record<string, unknown>}
 */
const recordOf = (value, what) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw Error(`${what} is a record`);
  return fromEntries(entries(value));
};

/**
 * `value`, a JSON object of strings from the page, as a record of them.
 *
 * @param {unknown} value
 * @param {string} what it is, for the error
 * @returns {Record<string, string>}
 */
const stringsOf = (value, what) =>
  fromEntries(
    entries(recordOf(value, what)).map(([key, v]) => {
      if (typeof v !== 'string') throw Error(`${what}.${key} is a string`);
      return [key, v];
    }),
  );

/**
 * `value`, the page's slots for a definition, each with its label.
 *
 * @param {unknown} value
 * @returns {Definition['slots']}
 */
const slotsOf = value =>
  fromEntries(
    entries(recordOf(value, 'slots')).map(([name, slot]) => {
      const { label } = recordOf(slot, `slots.${name}`);
      if (typeof label !== 'string')
        throw Error(`slots.${name}.label is a string`);
      return [name, { label }];
    }),
  );

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
  /** @type {MapStore<'equipment', Equipment>} as the boot vat last equipped the gateway */
  const equipped = zone.mapStore('equipped');
  /** @type {MapStore<'names', string[]>} the owner starters offered so far */
  const offeredStore = zone.mapStore('offered');

  /** The definer, which runs an endowed definition in a vat of its own. */
  const definer = () => {
    if (!equipped.has('equipment'))
      throw Error('this gateway has no definer, so it runs no definitions');
    return equipped.get('equipment').definer;
  };

  const agentsKit = prepareAgentsKit(zone.subZone('agents'), {
    E,
    Far,
    M,
    starters,
    definer,
  });

  /** @type {() => Registry<Host | Guest | Invitation>} */
  const makeRegistry = prepareRegistry(zone.subZone('registry'), {
    E,
    M,
    entropy,
  });
  /** each agent's own facet, and each open invitation, by the swiss number in its link */
  const links = zone.makeOnce('links', () => makeRegistry());
  /**
   * each page a host serves: the object whose `handle(request)` answers its
   * link. One kind of registry keeps both; this one keeps pages.
   */
  const pages = zone.makeOnce('pages', () =>
    /** @type {() => Registry<Remote<PageHandler>>} the same maker, keeping pages */ (
      /** @type {unknown} */ (makeRegistry)
    )(),
  );

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
    const made = await agentsKit.accept(
      links.deref(invite),
      kit && 'host' in kit ? kit : undefined,
    );
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
   * `agent` as a host, for what only a host does.
   *
   * @param {Agent} agent @param {string} what
   */
  const hostOf = (agent, what) => {
    if (agent.kind !== 'host') throw Error(`only a host ${what}`);
    return agent.kit.host;
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
    const own = agent.kind === 'host' ? agent.kit.host : agent.kit.guest;
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
      case 'define':
        if (agent.kind !== 'guest') throw Error('only a guest defines');
        agent.kit.guest.define(
          harden(stringsOf(req.modules, 'modules')),
          harden(slotsOf(req.slots)),
        );
        return {};
      case 'endow': {
        const saveAs = String(req.saveAs ?? '');
        await hostOf(agent, 'endows').endow(
          Number(req.number),
          stringsOf(req.bindings, 'bindings'),
          saveAs,
        );
        return { answer: { '@name': saveAs } };
      }
      case 'invite':
        return {
          invite: await links.register(
            hostOf(agent, 'invites').invite(String(req.peer)),
          ),
        };
      case 'servePage': {
        hostOf(agent, 'serves pages');
        const name = String(req.name);
        if (!names.nameHub.has(name))
          throw Error(`no ${JSON.stringify(name)} here`);
        // whatever the host names: what its `handle` answers is checked as it's served
        const target = /** @type {Remote<PageHandler>} */ (
          await names.nameHub.lookup(name)
        );
        return { page: await pages.register(target) };
      }
      case 'provideGuest':
        return {
          guest: await links.register(
            await hostOf(agent, 'makes guests').provideGuest(String(req.name)),
          ),
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
    if (String(req.op) === 'accept') {
      if (agent && agent.kind !== 'host')
        throw Error('only a host accepts invitations');
      return accept(req.invite, agent?.kit);
    }
    if (!agent) throw Error('no agent');
    return operate(agent, req);
  };

  /**
   * A page a host served, posted to {@link SERVED} with its swiss number
   * in the body (see pages.js): the request goes to the object the number
   * keeps, and its answer comes back in a sandbox (an opaque origin, no
   * scripts), so the page can't reach the wallet's storage, where each
   * browser keeps its agent's swiss number. Of the answer's headers, only
   * its type and disposition pass, and its forms post back here.
   *
   * @param {string} body the form's
   * @returns {Promise<HttpResponse>}
   */
  const servePage = async body => {
    const { page: swiss, path, labels } = pageRequestOf(body);
    const target = pages.deref(swiss);
    if (!target) return { status: 404, body: 'not here\n' };
    const request = { method: 'POST', path, labels, body: '' };
    const answer =
      /** @type {Partial<HttpResponse>} a page's answer, checked below */ (
        await E(target).handle(harden(request))
      );
    /** @type {Record<string, string>} */
    const headers = {
      'content-security-policy': 'sandbox allow-forms allow-downloads',
      'cache-control': 'no-store',
    };
    for (const h of ['content-type', 'content-disposition']) {
      const v = answer?.headers?.[h];
      if (typeof v === 'string') headers[h] = v;
    }
    const text = typeof answer?.body === 'string' ? answer.body : '';
    return {
      status: typeof answer?.status === 'number' ? answer.status : 200,
      headers,
      body: /^text\/html\b/.test(headers['content-type'] ?? '')
        ? postingBack(text, swiss)
        : text,
    };
  };

  const makeHandler = zone.exoClass('Handler', undefined, () => ({}), {
    /** @param {HttpRequest} request */
    async handle({ method, path, body }) {
      if (method === 'POST' && path === SERVED) return servePage(body);
      if (method === 'GET' && path === '/page')
        return {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          },
          body: LOADER,
        };
      if (method === 'GET' && path === '/page.js')
        return {
          status: 200,
          headers: {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-store',
          },
          body: LOADER_SCRIPT,
        };
      if (method === 'GET' && path === '/')
        return {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          },
          body: PAGE,
        };
      if (method === 'GET' && path === '/wallet.js')
        return {
          status: 200,
          headers: {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-store',
          },
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

  /**
   * What the owner's host starts with beyond the starters, as the boot vat
   * last equipped the gateway.
   *
   * @returns {Record<string, Remote>}
   */
  const ownerStarters = () =>
    equipped.has('equipment') ? equipped.get('equipment').ownerStarters : {};

  /** The agents, by the swiss numbers in their links. */
  const agentsFacet = zone.exo('Agents', undefined, {
    /**
     * The agent a swiss number keeps, as the page reaches it with that
     * link: its NameHub, its NameAdmin, and its own facet, as `host` or
     * `guest`; it throws for a swiss number that keeps none. OCapN's
     * bootstrap object calls this `fetch`.
     *
     * @see https://github.com/ocapn/ocapn/blob/main/draft-specifications/CapTP%20Specification.md#fetch-method
     * @param {SwissNum} swiss
     */
    deref(swiss) {
      const agent = agentAt(swiss);
      if (!agent) throw Error('no such agent');
      return agent.kind === 'host'
        ? harden({ ...agent.kit.host.names(), host: agent.kit.host })
        : harden({ ...agent.kit.guest.names(), guest: agent.kit.guest });
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
        gateway.init('owner', agentsKit.newHost('owner', ownerStarters()).host);
      return `#agent=${await links.register(gateway.get('owner'))}`;
    },
    agents: () => agentsFacet,
    invites: () => invitesFacet,
    /**
     * At each start, from the boot vat: the definer, and what the owner's
     * host starts with. An owner's host made before then gets each starter
     * it lacks once, the first time it's offered, so a name its owner
     * forgets stays forgotten, and a starter added later still arrives.
     *
     * @param {Equipment} equipment
     */
    equip(equipment) {
      const before = equipped.has('equipment')
        ? equipped.get('equipment')
        : undefined;
      if (before) equipped.set('equipment', equipment);
      else equipped.init('equipment', equipment);
      // a gateway equipped before `offered` was kept offered what it was equipped with
      const offered = offeredStore.has('names')
        ? offeredStore.get('names')
        : before
          ? keys(before.ownerStarters)
          : [];
      const fresh = keys(equipment.ownerStarters).filter(
        name => !offered.includes(name),
      );
      if (offeredStore.has('names'))
        offeredStore.set('names', harden([...offered, ...fresh]));
      else offeredStore.init('names', harden([...offered, ...fresh]));
      if (!gateway.has('owner') || !fresh.length) return;
      agentsKit.addNames(
        gateway.get('owner'),
        fromEntries(fresh.map(name => [name, equipment.ownerStarters[name]])),
      );
    },
  });
};
