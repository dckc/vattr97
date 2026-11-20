/**
 * One party's side of Horton (Higher-Order Responsibility Tracking of
 * Objects in Networks), after Miller, Donnelley, and Karp, "Delegating
 * Responsibility in Digital Systems: Horton's 'Who Done It?'" (HotSec
 * 2007). The party's app objects reach other parties' objects through its
 * proxies, each tagged with whom to blame for the service; other parties
 * reach its objects through its stubs, each tagged with whom to blame for
 * the requests. When a proxy's argument is another proxy, the party asks
 * that proxy's owner for a stub for the receiver's use, gift-wrapped so
 * only the receiver can open it, and only from that owner.
 *
 * The party logs each request it sends and serves, and each introduction
 * it makes; `shutOff(who)` refuses that party's requests from then on, and
 * stops sending it any.
 *
 * E's proxies take any message, by `match`. A toybox object has the
 * methods its kind defines, so a proxy takes its methods from its stub's
 * target, by the `__getMethodNames__` that every remotable answers (as
 * @endo/marshal's dot-membrane does), in a kind for each set of names (as
 * @agoric/base-zone's revocable kit does).
 *
 * @see https://erights.org/download/horton/ the paper's Java and E code
 */

/** @import { BuildRootObject, MapStore, Remote } from '../../src/types.js' */

/**
 * @typedef {object} Params
 * @property {string} label the name this party proposes for itself
 */

/**
 * An argument as a stub's `deliver` gets it: a gift from the party that
 * made the proxy argument, or plain data.
 *
 * @typedef {{ gift: Remote, from: Remote } | { data: Scalar }} Desc
 * @typedef {string | number | boolean | null} Scalar
 */

const { fromEntries } = Object;

/** A meta-method, such as `__getMethodNames__`: not the target's to forward. @param {string} name */
const isMeta = name => name.startsWith('__');

/** @param {unknown} x @returns {x is Scalar} */
const isScalar = x =>
  x === null || ['string', 'number', 'boolean'].includes(typeof x);

/** @satisfies {BuildRootObject<Params>} */
export const buildRootObject = ({ E, Far, zone }, { label }) => {
  /** @type {MapStore<Remote, string>} pet names, by Who */
  const petNames = zone.mapStore('petNames');
  /** @type {MapStore<Remote, true>} Whos shut off */
  const shut = zone.mapStore('shut');
  /** @type {MapStore<number, string>} */
  const log = zone.mapStore('log');
  /** @type {MapStore<object, { stub: Remote, whoBlame: Remote }>} each proxy's guts, by rights amplification */
  const guts = zone.mapStore('guts');
  /** @type {MapStore<string, string[]>} each proxy kind's method names, by tag */
  const proxyKinds = zone.mapStore('proxyKinds');

  const note = (/** @type {string} */ line) => log.init(log.getSize(), line);

  /** A pet name, or else the name it proposes, in quotes. @param {Remote} who */
  const nameOf = async who =>
    petNames.has(who) ? petNames.get(who) : `"${await E(who).getLabel()}"`;

  /** @param {Remote} who @param {string} what */
  const refuseIfShut = (who, what) => {
    if (shut.has(who)) throw Error(`${what}: shut off`);
  };

  /**
   * Sealed boxes, by box: a box is good for one protocol run, so a
   * restart may drop them.
   *
   * @type {WeakMap<object, unknown>}
   */
  const sealed = new WeakMap();

  const makeMe = zone.exoClassKit('Me', undefined, () => ({}), {
    /** The party's public identity: anyone may seal a box only it can open. */
    who: {
      getLabel: () => label,
      /** @param {unknown} contents */
      seal: contents => {
        const box = Far('Box', {});
        sealed.set(box, contents);
        return box;
      },
    },
    /** The authority to be this party: open what was sealed for it. */
    beMe: {
      /** @param {object} box */
      unseal: box => {
        if (!sealed.has(box)) throw Error('not sealed for me');
        return sealed.get(box);
      },
    },
  });
  const { who, beMe } = zone.makeOnce('me', makeMe);

  /**
   * Wrap `s3` so that only `whoBob` can open it, and only as from me: the
   * box holds a provide function that answers only a fill function sealed
   * for me.
   *
   * @param {Remote} s3 @param {Remote} whoBob
   */
  const wrap = (s3, whoBob) =>
    E(whoBob).seal(
      Far('Provide', {
        /** @param {object} fillBox */
        provide: fillBox =>
          E(/** @type {Remote} */ (beMe.unseal(fillBox))).fill(s3),
      }),
    );

  /**
   * Open a gift that `whoCarol` allegedly wrapped for me: only she can
   * open the box holding my fill function, so only she can fill it.
   *
   * @param {object} gift @param {Remote} whoCarol
   */
  const unwrap = async (gift, whoCarol) => {
    const provide = /** @type {Remote} */ (beMe.unseal(gift));
    /** @type {Remote | undefined} */
    let result;
    const fillBox = await E(whoCarol).seal(
      Far('Fill', {
        /** @param {Remote} s3 */
        fill: s3 => {
          result = s3;
        },
      }),
    );
    await E(provide).provide(fillBox);
    if (result === undefined) throw Error('gift not provided');
    return result;
  };

  /**
   * A stub: how `whoBlame` reaches my `target`, and is held responsible.
   */
  const makeStub = zone.exoClass(
    'Stub',
    undefined,
    (/** @type {Remote} */ whoBlame, /** @type {Remote} */ target) => ({
      whoBlame,
      target,
    }),
    {
      /**
       * `whoBlame` shares this stub's target with `whoBob`: a stub for Bob,
       * wrapped for him.
       *
       * @param {Remote} whoBob
       */
      async intro(whoBob) {
        const { whoBlame, target } = this.state;
        refuseIfShut(whoBlame, 'intro');
        note(`${await nameOf(whoBlame)} shared with ${await nameOf(whoBob)}`);
        return wrap(makeStub(whoBob, target), whoBob);
      },
      /** @param {string} verb @param {Desc[]} descs */
      async deliver(verb, descs) {
        const { whoBlame, target } = this.state;
        const args = await Promise.all(
          descs.map(async d =>
            'data' in d
              ? d.data
              : await makeProxy(d.from, await unwrap(d.gift, d.from)),
          ),
        );
        refuseIfShut(whoBlame, verb);
        note(`${await nameOf(whoBlame)} asked ${verb}`);
        return E(target)[verb](...args);
      },
      /** The methods of this stub's target, for a proxy to it to forward. */
      async getMethodNames() {
        refuseIfShut(this.state.whoBlame, 'getMethodNames');
        /** @type {string[]} */
        const names = await E(this.state.target).__getMethodNames__();
        return names.filter(name => !isMeta(name));
      },
    },
  );

  /**
   * Forward `verb(...args)` along `proxy`'s path, introducing each proxy
   * argument's owner to the receiver.
   *
   * @param {object} proxy @param {string} verb @param {unknown[]} args
   */
  const forward = async (proxy, verb, args) => {
    const { stub, whoBlame } = guts.get(proxy);
    refuseIfShut(whoBlame, verb);
    /** @type {Desc[]} */
    const descs = await Promise.all(
      args.map(async arg => {
        if (isScalar(arg)) return { data: arg };
        if (typeof arg !== 'object' || arg === null || !guts.has(arg))
          throw Error(`${verb}: pass proxies of mine, or scalars`);
        const { stub: s2, whoBlame: whoCarol } = guts.get(arg);
        return { gift: await E(s2).intro(whoBlame), from: whoCarol };
      }),
    );
    note(`asked ${await nameOf(whoBlame)} to ${verb}`);
    return E(stub).deliver(verb, descs);
  };

  /**
   * The kind of proxy with methods `names`, defined the first time it's
   * asked for, and in every incarnation after.
   *
   * @type {Map<string, () => object>}
   */
  const proxyMakers = new Map();
  /** @param {string} tag @param {string[]} names */
  const defineProxyKind = (tag, names) => {
    const make = zone.exoClass(
      tag,
      undefined,
      () => ({}),
      fromEntries(
        names.map(verb => [
          verb,
          /** @this {{ self: object }} @param {unknown[]} args */
          function (...args) {
            return forward(this.self, verb, args);
          },
        ]),
      ),
    );
    proxyMakers.set(tag, make);
    return make;
  };
  for (const [tag, names] of proxyKinds.entries()) defineProxyKind(tag, names);
  /** @param {string[]} names */
  const provideProxyMaker = names => {
    const sorted = [...names].sort();
    const tag = `Proxy(${sorted.join(',')})`;
    const found = proxyMakers.get(tag);
    if (found) return found;
    proxyKinds.init(tag, harden(sorted));
    return defineProxyKind(tag, sorted);
  };

  /**
   * A proxy to `stub`, with its target's methods, blaming `whoBlame` for
   * its service.
   *
   * @param {Remote} whoBlame @param {Remote} stub
   */
  const makeProxy = async (whoBlame, stub) => {
    const names = await E(stub).getMethodNames();
    const proxy = provideProxyMaker(names)();
    guts.init(proxy, harden({ stub, whoBlame }));
    return proxy;
  };

  return Far('hortonRoot', {
    getWho: () => who,
    /** @param {Remote} someone @param {string} petName */
    setPetName: (someone, petName) => petNames.init(someone, petName),
    /** Base case, exporting: a stub for `whoBlame` to reach `target`. @param {Remote} whoBlame @param {Remote} target */
    makeStub: (whoBlame, target) => makeStub(whoBlame, target),
    makeProxy,
    /** Refuse `someone`'s requests, and send it none. @param {Remote} someone */
    shutOff: someone => {
      if (!shut.has(someone)) shut.init(someone, true);
    },
    getLog: () => log.values(),
  });
};
