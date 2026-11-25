/**
 * The wallet's agents, after endo's hosts and guests: each a NameHub and
 * its NameAdmin, after Agoric's, and an inbox.
 *
 * An agent's facets are its owner's (`host` or `guest`), its `handle`,
 * which others name it by and send to, and its `receiver`, which only the
 * kinds here reach. A handle has no methods: `send(to, strings, edgeNames,
 * petNames)` is the sender's own, by pet names, so a message carries
 * references the sender names, and its recipient sees the name they know
 * the sender by, so no sender can pass as another.
 *
 * Hosts meet by invitation: `invite(peer)` makes a one-time invitation;
 * whoever accepts it, as a host of their own or a new one, names the
 * inviter's handle, and the inviter theirs. A host makes guests:
 * `provideGuest(name)`, whose one correspondent at first is the host.
 *
 * A guest proposes definitions to its host, after endo's: `define(modules,
 * slots)` proposes a vat's modules, its params named by `slots`, each with
 * a label saying what it's for. The host reads the source, and may `endow`
 * it: fill each slot with something it names, run it in a vat of its own,
 * and name its root. The root is the host's alone, to keep or send on; the
 * guest gets nothing back. So a guest, who holds less, can ask for an
 * attenuation of what its host holds, and the host decides what goes in
 * and who gets what comes out.
 */
import { prepareNameHubKit } from './name-hub.js';

/**
 * @import { Key, MapStore, Powers, Remote, Zone } from '@vattr/toybox/src/types.js';
 * @import { NameHubKit } from './name-hub.js';
 */

const { entries, fromEntries, getPrototypeOf, hasOwn, keys } = Object;

/**
 * A proposed vat's modules, as an installer takes them (each one's source,
 * by its path), and its params by name, each with what it's for.
 *
 * @typedef {{ modules: Record<string, string>, slots: Record<string, { label: string }> }} Definition
 */

/**
 * A message, as an inbox keeps it: from the sender's handle, a package of
 * text and references (`strings` around `names`, the edge names of
 * `refs`), or a definition.
 *
 * @typedef {{ from: object } & ({ type: 'package', strings: string[], names: string[], refs: unknown[] } | ({ type: 'definition' } & Definition))} Message
 */

/** A slot's name, as a module destructures its params. */
const SLOT = /^[A-Za-z_$][\w$]*$/;

/** A segment of a module's path, as the installer takes one: no `..`, no dotfile. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Refuse `modules`, proposed as a definition, unless the installer would
 * take them as a vat whose main module is `main.js`. A `worker.json`,
 * which would set the vat's compatibility date and flags, is the host's
 * to choose, not the guest's.
 *
 * @param {Definition['modules']} modules
 */
const checkModules = modules => {
  for (const path of keys(modules))
    if (!path.split('/').every(segment => SEGMENT.test(segment)))
      throw Error(`define: not a module path: ${JSON.stringify(path)}`);
  if (hasOwn(modules, 'worker.json'))
    throw Error("define: a worker.json is the host's to choose");
  if (!hasOwn(modules, 'main.js')) throw Error('define: no main.js');
};

/**
 * The definer, as the boot vat makes it: `run(modules, params)` makes a
 * vat of `modules` with `params`, and answers its root, whose type only
 * its modules say.
 *
 * @typedef {{ run(modules: Definition['modules'], params: Record<string, Remote>): Promise<Remote> }} Definer
 */

/**
 * Whether `value` is a reference, not data: a remotable, local or a
 * presence. Copied records and arrays have the plain prototypes.
 *
 * @param {unknown} value
 * @returns {value is object}
 */
export const isRef = value =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  getPrototypeOf(value) !== Object.prototype;

/**
 * Name `ref` as `name` in `names`.
 *
 * @param {NameHubKit} names @param {string} name @param {unknown} ref
 */
export const save = (names, name, ref) => {
  if (!name) throw Error('a name, please');
  names.nameAdmin.update(name, ref);
};

/**
 * A name not yet taken in `names`: `base`, or `base-2`, `base-3`, ...
 *
 * @param {NameHubKit} names @param {string} base
 */
const fresh = ({ nameHub }, base) => {
  let name = base;
  for (let n = 2; nameHub.has(name); n += 1) name = `${base}-${n}`;
  return name;
};

/**
 * Define the kinds of host, guest, and invitation, in `zone`, and answer
 * the agents kit, for the vat that holds it: what makes and finds agents,
 * and accepts invitations. It deals in references; a link to one, such as
 * a swiss number, is the holder's to make.
 *
 * @param {Zone} zone
 * @param {Pick<Powers, 'E' | 'Far' | 'M'> & { starters: Record<string, Remote>, definer: () => Remote<Definer> }} powers
 *   `starters`, what every new host names; `definer`, which runs an endowed definition in a vat of its own
 */
export const prepareAgentsKit = (zone, { E, Far, M, starters, definer }) => {
  /** @typedef {ReturnType<typeof makeHost>} HostKit */
  /** @typedef {ReturnType<typeof makeGuest>} GuestKit */
  /** @typedef {HostKit['host']} Host a host's own facet */
  /** @typedef {GuestKit['guest']} Guest a guest's own facet */
  /** @typedef {{ kind: 'host', kit: HostKit } | { kind: 'guest', kit: GuestKit }} Agent */

  /** @type {MapStore<Key, Agent>} each agent, by its host or guest, and by its handle */
  const agentOf = zone.mapStore('agent of');
  /** @type {MapStore<Key, { inviter: HostKit, peer: string }>} each open invitation's inviter, and what it names whoever accepts */
  const invitations = zone.mapStore('invitations');

  /** An invitation, from one host to whoever accepts it, for one use. */
  const makeInvitation = zone.exoClass(
    'Invitation',
    M.interface('Invitation', { accept: M.callWhen().returns(M.record()) }),
    () => ({}),
    {
      /** Accept it as a new host: that host, and the name it knows the inviter by. */
      async accept() {
        const { host, inviter } = await accept(this.self);
        if (!host) throw Error('accepted as no new host');
        return harden({ host, inviter });
      },
    },
  );

  const makeNameHubKit = prepareNameHubKit(zone, { M });

  /**
   * An agent's mail, as its state keeps it, which its facets share.
   *
   * @typedef {{ label: string, names: NameHubKit, inbox: MapStore<number, Message>, nextMessage: number }} Mail
   */

  /**
   * The receiver behind `to`, which `name` names: `to` must be a handle.
   *
   * @param {unknown} to @param {string} name
   */
  const receiverOf = (to, name) => {
    const agent = isRef(to) && agentOf.has(to) ? agentOf.get(to) : undefined;
    if (!agent || agent.kit.handle !== to)
      throw Error(`${JSON.stringify(name)} names no correspondent`);
    return agent.kit.receiver;
  };

  /**
   * The inbox, in the order it came, each message as data, from the name
   * its sender's handle has here, or `null` if it has none.
   *
   * @param {Mail} mail
   */
  const listMessages = ({ names, inbox }) => {
    const nameOf = new Map(
      names.nameHub.entries().map(([name, ref]) => [ref, name]),
    );
    return [...inbox.entries()]
      .sort(([a], [b]) => a - b)
      .map(([number, message]) => {
        const from = nameOf.get(message.from) ?? null;
        if (message.type === 'package') {
          const { type, strings, names: edgeNames } = message;
          return harden({ number, from, type, strings, names: edgeNames });
        }
        const { type, modules, slots } = message;
        return harden({ number, from, type, modules, slots });
      });
  };

  /** @typedef {ReturnType<typeof listMessages>[number]} ListedMessage a message, as its recipient lists it */

  /**
   * Name `petName` what message `number` calls `edgeName`.
   *
   * @param {Mail} mail @param {number} number @param {string} edgeName @param {string} petName
   */
  const adopt = ({ names, inbox }, number, edgeName, petName) => {
    if (!inbox.has(number)) throw Error(`no message ${number}`);
    const message = inbox.get(number);
    if (message.type !== 'package')
      throw Error(`message ${number} is not a package`);
    const index = message.names.indexOf(edgeName);
    if (index < 0)
      throw Error(`message ${number} has no ${JSON.stringify(edgeName)}`);
    save(names, petName, message.refs[index]);
  };

  /**
   * Send `to` a package: `strings` around what `petNames` name here, which
   * the recipient sees as `edgeNames`, from `handle`.
   *
   * @param {Mail} mail @param {object} handle
   * @param {string} to @param {string[]} strings @param {string[]} edgeNames @param {string[]} petNames
   */
  const send = async ({ names }, handle, to, strings, edgeNames, petNames) => {
    if (edgeNames.length !== petNames.length)
      throw Error('send: an edge name for each pet name, please');
    if (strings.length < petNames.length)
      throw Error('send: a string before each name, please');
    const receiver = receiverOf(await names.nameHub.lookup(to), to);
    const refs = await Promise.all(petNames.map(n => names.nameHub.lookup(n)));
    receiver.receive(
      harden({
        from: handle,
        type: 'package',
        strings,
        names: edgeNames,
        refs,
      }),
    );
  };

  /**
   * Who waits for each agent's next message, by its handle: promises,
   * which last only as long as this incarnation, as do the calls waiting
   * on them.
   *
   * @type {WeakMap<object, Set<() => void>>}
   */
  const waiting = new WeakMap();

  /**
   * File `message`, and wake whoever waits for it.
   *
   * @param {Mail} mail @param {object} handle @param {Message} message
   */
  const receive = (mail, handle, message) => {
    const number = mail.nextMessage;
    mail.nextMessage += 1;
    mail.inbox.init(number, message);
    const waiters = waiting.get(handle) ?? new Set();
    waiting.delete(handle);
    for (const wake of waiters) wake();
  };

  /**
   * The first message in the inbox numbered above `after`, once there is
   * one.
   *
   * @param {Mail} mail @param {object} handle @param {number} after
   */
  const waitForMessage = async (mail, handle, after) => {
    for (;;) {
      const found = listMessages(mail).find(m => m.number > after);
      if (found) return found;
      /** @type {PromiseWithResolvers<void>} */
      const woken = Promise.withResolvers();
      const waiters = waiting.get(handle) ?? new Set();
      waiting.set(handle, waiters.add(woken.resolve));
      await woken.promise;
    }
  };

  /**
   * Its messages, those in the inbox, then each as it comes, as an async
   * iterator, after endo's `followMessages`. The iterator lasts as long as
   * this incarnation.
   *
   * @param {Mail} mail @param {object} handle
   */
  const followMessages = (mail, handle) => {
    let seen = 0;
    return Far('MessageIterator', {
      /** @returns {Promise<IteratorYieldResult<ListedMessage>>} */
      async next() {
        const value = await waitForMessage(mail, handle, seen);
        seen = value.number;
        return harden({ value, done: false });
      },
      /** @returns {IteratorReturnResult<undefined>} */
      return: () => harden({ value: undefined, done: true }),
    });
  };

  /** @param {string} label */
  const initMail = label => ({
    label,
    names: makeNameHubKit(),
    /** @type {MapStore<number, Message>} */
    inbox: zone.detached().mapStore('inbox'),
    nextMessage: 1,
  });

  /** A NameHubKit, as a pattern. */
  const NameHubKitShape = harden({
    nameHub: M.remotable('NameHub'),
    nameAdmin: M.remotable('NameAdmin'),
  });
  const mailGuards = harden({
    names: M.call().returns(NameHubKitShape),
    listMessages: M.call().returns(M.array()),
    followMessages: M.call().returns(M.remotable('MessageIterator')),
    adopt: M.call(M.number(), M.string(), M.string()).returns(),
    dismiss: M.call(M.number()).returns(),
    send: M.callWhen(
      M.string(),
      M.arrayOf(M.string()),
      M.arrayOf(M.string()),
      M.arrayOf(M.string()),
    ).returns(),
  });
  const HandleI = M.interface('Handle', {});
  const receiverGuards = harden({
    label: M.call().returns(M.string()),
    receive: M.call(M.record()).returns(),
  });

  /**
   * A host, after endo's: its own facet adopts and dismisses messages,
   * sends, endows definitions, invites peers, and makes guests.
   */
  const makeHost = zone.exoClassKit(
    'Host',
    {
      host: M.interface('Host', {
        ...mailGuards,
        endow: M.callWhen(
          M.number(),
          M.recordOf(M.string(), M.string()),
          M.string(),
        ).returns(),
        invite: M.call(M.string()).returns(M.remotable('Invitation')),
        provideGuest: M.callWhen(M.string()).returns(M.remotable('Guest')),
      }),
      handle: HandleI,
      receiver: M.interface('HostReceiver', receiverGuards),
    },
    initMail,
    {
      host: {
        /** Its NameHub, to read its names, and NameAdmin, to write them. */
        names() {
          return this.state.names;
        },
        listMessages() {
          return listMessages(this.state);
        },
        followMessages() {
          return followMessages(this.state, this.facets.handle);
        },
        /** @param {number} number @param {string} edgeName @param {string} petName */
        adopt(number, edgeName, petName) {
          adopt(this.state, number, edgeName, petName);
        },
        /** @param {number} number */
        dismiss(number) {
          this.state.inbox.delete(number);
        },
        /** @param {string} to @param {string[]} strings @param {string[]} edgeNames @param {string[]} petNames */
        async send(to, strings, edgeNames, petNames) {
          const { handle } = this.facets;
          await send(this.state, handle, to, strings, edgeNames, petNames);
        },
        /**
         * Run the definition in message `number` in a vat of its own, each
         * slot filled with what `bindings` names for it here, and name its
         * root `saveAs`.
         *
         * @param {number} number
         * @param {Record<string, string>} bindings slot name to a name here
         * @param {string} saveAs
         */
        async endow(number, bindings, saveAs) {
          const { inbox, names } = this.state;
          if (!inbox.has(number)) throw Error(`no message ${number}`);
          const message = inbox.get(number);
          if (message.type !== 'definition')
            throw Error(`message ${number} is not a definition`);
          const { modules, slots } = message;
          const unfilled = keys(slots).filter(slot => !hasOwn(bindings, slot));
          if (unfilled.length)
            throw Error(`endow: nothing for ${unfilled.join(', ')}`);
          const extra = keys(bindings).filter(name => !hasOwn(slots, name));
          if (extra.length) throw Error(`endow: no slot ${extra.join(', ')}`);
          // before the vat is made, so a refusal leaves none behind
          if (!saveAs) throw Error('endow: a name to save it as, please');
          const params = fromEntries(
            await Promise.all(
              keys(slots).map(async slot => [
                slot,
                await names.nameHub.lookup(bindings[slot]),
              ]),
            ),
          );
          save(names, saveAs, await E(definer()).run(modules, harden(params)));
        },
        /**
         * An invitation: whoever accepts it is named `peer` here, and
         * names this host.
         *
         * @param {string} peer
         */
        invite(peer) {
          const invitation = makeInvitation();
          invitations.init(invitation, harden({ inviter: this.facets, peer }));
          return invitation;
        },
        /**
         * A guest of this host's, named `name` here: the one `name` names,
         * or a new one, for whoever is to be it.
         *
         * @param {string} name
         */
        async provideGuest(name) {
          const { names } = this.state;
          const { handle } = this.facets;
          // before the guest is made, so a refusal leaves none behind
          if (!name) throw Error('provideGuest: a name, please');
          if (names.nameHub.has(name)) {
            const known = await names.nameHub.lookup(name);
            const agent =
              isRef(known) && agentOf.has(known) && agentOf.get(known);
            if (
              !agent ||
              agent.kind !== 'guest' ||
              agent.kit.handle !== known ||
              agent.kit.receiver.host() !== handle
            )
              throw Error(`${JSON.stringify(name)} names no guest of yours`);
            return agent.kit.guest;
          }
          const kit = makeGuest(name, handle);
          const agent = harden({ kind: /** @type {const} */ ('guest'), kit });
          agentOf.init(kit.guest, agent);
          agentOf.init(kit.handle, agent);
          save(names, name, kit.handle);
          return kit.guest;
        },
      },
      handle: {},
      receiver: {
        /** What its owner was called when it was made, which an introduction names it by. */
        label() {
          return this.state.label;
        },
        /** @param {Message} message */
        receive(message) {
          receive(this.state, this.facets.handle, message);
        },
      },
    },
  );

  /**
   * A guest, after endo's: made by its host, and named `host` among its
   * names, it proposes definitions to its host, and otherwise has what
   * it's sent.
   *
   * Its names are two objects, a NameHub to read them and a NameAdmin to
   * write them, so it can hand on reading without writing. An endo guest
   * is itself a NameHub that reads and writes, with no read-only view.
   *
   * @see {@link https://github.com/endojs/endo/blob/master/packages/daemon/src/types.d.ts EndoGuest, EndoDirectory, NameHub}
   */
  const makeGuest = zone.exoClassKit(
    'Guest',
    {
      guest: M.interface('Guest', {
        ...mailGuards,
        define: M.call(
          M.recordOf(M.string(), M.string()),
          M.recordOf(M.string(), harden({ label: M.string() })),
        ).returns(),
      }),
      handle: HandleI,
      receiver: M.interface('GuestReceiver', {
        ...receiverGuards,
        host: M.call().returns(M.remotable()),
      }),
    },
    (
      /** @type {string} */ label,
      /** @type {object} its host's handle, which has no methods */ host,
    ) => {
      const mail = initMail(label);
      mail.names.nameAdmin.update('host', host);
      return { ...mail, host };
    },
    {
      guest: {
        /** Its NameHub, to read its names, and NameAdmin, to write them. */
        names() {
          return this.state.names;
        },
        listMessages() {
          return listMessages(this.state);
        },
        followMessages() {
          return followMessages(this.state, this.facets.handle);
        },
        /** @param {number} number @param {string} edgeName @param {string} petName */
        adopt(number, edgeName, petName) {
          adopt(this.state, number, edgeName, petName);
        },
        /** @param {number} number */
        dismiss(number) {
          this.state.inbox.delete(number);
        },
        /** @param {string} to @param {string[]} strings @param {string[]} edgeNames @param {string[]} petNames */
        async send(to, strings, edgeNames, petNames) {
          const { handle } = this.facets;
          await send(this.state, handle, to, strings, edgeNames, petNames);
        },
        /**
         * Propose to its host a vat of `modules`, its params named by
         * `slots`.
         *
         * @param {Definition['modules']} modules
         * @param {Definition['slots']} slots
         */
        define(modules, slots) {
          for (const name of keys(slots))
            if (!SLOT.test(name) || name === '__proto__')
              throw Error(`define: not a slot name: ${JSON.stringify(name)}`);
          checkModules(modules);
          receiverOf(this.state.host, 'host').receive(
            harden({
              from: this.facets.handle,
              type: 'definition',
              modules,
              slots,
            }),
          );
        },
      },
      handle: {},
      receiver: {
        /** What its host named it. */
        label() {
          return this.state.label;
        },
        /** @param {Message} message */
        receive(message) {
          receive(this.state, this.facets.handle, message);
        },
        /** Its host's handle. */
        host() {
          return this.state.host;
        },
      },
    },
  );

  /**
   * A new host, naming the starters and `more`.
   *
   * @param {string} label
   * @param {Record<string, Remote>} [more]
   */
  const newHost = (label, more = {}) => {
    const kit = makeHost(label);
    for (const [name, ref] of entries({ ...starters, ...more }))
      save(kit.host.names(), name, ref);
    const agent = harden({ kind: /** @type {const} */ ('host'), kit });
    agentOf.init(kit.host, agent);
    agentOf.init(kit.handle, agent);
    return kit;
  };

  /**
   * Have each of two hosts name the other's handle: `a` names `b` as
   * `bName` (or the next free name), and `b` names `a` by its label.
   *
   * @param {HostKit} a @param {string} bName @param {HostKit} b
   */
  const introduce = (a, bName, b) => {
    const aCallsB = fresh(a.host.names(), bName);
    const bCallsA = fresh(b.host.names(), a.receiver.label());
    save(a.host.names(), aCallsB, b.handle);
    save(b.host.names(), bCallsA, a.handle);
    return { aCallsB, bCallsA };
  };

  /**
   * Accept `invitation`: as the host `kit`, or as a new one, which it
   * answers. Either way, the name the host knows the inviter by.
   *
   * @param {unknown} invitation
   * @param {HostKit} [kit]
   * @returns {Promise<{ host?: Host, inviter: string }>}
   */
  const accept = async (invitation, kit) => {
    if (!isRef(invitation) || !invitations.has(invitation))
      throw Error('no such invitation, or it was used');
    const terms = invitations.get(invitation);
    const { inviter, peer } = terms;
    // gone before the await, so it's accepted once; back if accepting fails
    invitations.delete(invitation);
    try {
      const made = kit ?? newHost(peer);
      const { bCallsA } = introduce(inviter, peer, made);
      return { host: kit ? undefined : made.host, inviter: bCallsA };
    } catch (e) {
      invitations.init(invitation, terms);
      throw e;
    }
  };

  return harden({
    newHost,
    accept,
    /**
     * The agent whose own facet, `host` or `guest`, is `own`, if any.
     *
     * @param {unknown} own
     */
    agentOf: own => {
      if (!isRef(own) || !agentOf.has(own)) return undefined;
      const agent = agentOf.get(own);
      return agent.kit.handle === own ? undefined : agent;
    },
    /**
     * Name each of `refs` that `host` doesn't name yet.
     *
     * @param {Host} host @param {Record<string, Remote>} refs
     */
    addNames: (host, refs) => {
      const names = host.names();
      for (const [name, ref] of entries(refs))
        if (!names.nameHub.has(name)) save(names, name, ref);
    },
    /**
     * Name each of `refs` that `host` names, but as `undefined`.
     *
     * @param {Host} host @param {Record<string, Remote>} refs
     */
    mendNames: (host, refs) => {
      const names = host.names();
      const empty = names.nameHub
        .entries()
        .filter(([, ref]) => ref === undefined)
        .map(([name]) => name);
      for (const [name, ref] of entries(refs))
        if (empty.includes(name)) save(names, name, ref);
    },
  });
};

/** @typedef {ReturnType<typeof prepareAgentsKit>} AgentsKit */
/** @typedef {NonNullable<ReturnType<AgentsKit['agentOf']>>} Agent an agent: its kind, and its kit of facets */
/** @typedef {ReturnType<AgentsKit['newHost']>['host']} Host a host's own facet */
/** @typedef {Awaited<ReturnType<Host['provideGuest']>>} Guest a guest's own facet */
/** @typedef {ReturnType<Host['invite']>} Invitation */
