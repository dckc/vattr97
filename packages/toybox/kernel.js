/** @file The kernel: one Durable Object hosting many vats, each a facet on code installed at runtime, after SwingSet's kernel. */
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { RpcTarget, newWorkersRpcResponse } from 'capnweb';
import { makeMarshal } from '@endo/marshal';
import { Far } from '@endo/pass-style';
import KVAT_RUNTIME from 'kvat-runtime.txt';
import { makeBootBundles } from './devices/boot.js';
import { SCHEMA as BUNDLE_SCHEMA, makeBundles } from './devices/bundles.js';
import { makeEntropy } from './devices/entropy.js';
import { makeFetchDevices } from './devices/fetch.js';
import { SCHEMA as GIT_SCHEMA, makeGit } from './devices/git.js';
import { SCHEMA as INGRESS_SCHEMA, makeIngresses } from './devices/ingress.js';
import { makeNixStores } from './devices/nix-store.js';
import { makeVatAdmins } from './devices/vat-admin.js';

/**
 * @import { CapData, Clist, HttpRequest, HttpResponse, KernelObjects, KernelPowers } from './types.js';
 */

const SCHEMA = [
  // hash: of a bundle (devices/bundles.js); params: CapData whose slots are krefs
  'CREATE TABLE IF NOT EXISTS kvat (vat TEXT PRIMARY KEY, hash TEXT NOT NULL, params TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS kobject (kref TEXT PRIMARY KEY, owner TEXT NOT NULL, vref TEXT NOT NULL, UNIQUE (owner, vref))',
  'CREATE TABLE IF NOT EXISTS clist (vat TEXT NOT NULL, vref TEXT NOT NULL, kref TEXT NOT NULL, PRIMARY KEY (vat, vref), UNIQUE (vat, kref))',
  'CREATE TABLE IF NOT EXISTS kcounter (name TEXT PRIMARY KEY, n INTEGER NOT NULL)',
  // the boot vat, if this kernel has one
  'CREATE TABLE IF NOT EXISTS kboot (vat TEXT NOT NULL)',
  ...BUNDLE_SCHEMA,
  ...INGRESS_SCHEMA,
  ...GIT_SCHEMA,
];

/** The owner of the kernel's own objects, in `kobject`. */
const KERNEL = 'kernel';

/** A vref a vat may export: its root, an ephemeral, or a durable object or kit facet. */
const EXPORT = /^o\+(0|e\d+|d(\d+|s|r)\/\d+(:[A-Za-z_$][\w$]*)?)$/;

/** @param {CapData} capdata @param {(slot: string) => string} f */
const mapSlots = ({ body, slots }, f) => ({ body, slots: slots.map(f) });

/**
 * A party outside the kernel: its imports last as long as its session, and
 * it exports nothing.
 *
 * @returns {Clist}
 */
const makeSessionClist = () => {
  /** @type {Map<string, string>} */
  const byVref = new Map();
  /** @type {Map<string, string>} */
  const byKref = new Map();
  return {
    toKernel: vref => {
      const kref = byVref.get(vref);
      if (kref) return kref;
      throw Error(
        vref.startsWith('o+')
          ? 'a session exports nothing'
          : `this session holds no ${vref}`,
      );
    },
    toVat: kref => {
      let vref = byKref.get(kref);
      if (!vref) {
        vref = `o-${byKref.size + 1}`;
        byKref.set(kref, vref);
        byVref.set(vref, kref);
      }
      return vref;
    },
  };
};

/**
 * A marshal whose slots are krefs: each becomes a stand-in object in the
 * data, and back, so kernel objects' methods see references as objects.
 */
const makeKrefMarshal = () => {
  /** @type {WeakMap<object, string>} */
  const krefOf = new WeakMap();
  /** @param {string} kref */
  const standIn = kref => {
    const obj = Far(`kref ${kref}`, {});
    krefOf.set(obj, kref);
    return obj;
  };
  /** @param {unknown} obj */
  const toKref = obj => {
    const kref = typeof obj === 'object' && obj && krefOf.get(obj);
    if (!kref) throw Error('not a reference the kernel handed out');
    return kref;
  };
  const marshal = makeMarshal(toKref, standIn, {
    serializeBodyFormat: 'smallcaps',
    errorTagging: 'off',
  });
  return harden({
    /** @param {unknown} val @returns {CapData} */
    toCapData: val =>
      marshal.toCapData(
        harden(/** @type {any} marshal checks it's passable */ (val)),
      ),
    /** @param {CapData} capdata @returns {any} whatever the sender sent */
    fromCapData: capdata => marshal.fromCapData(capdata),
    standIn,
    /** @param {unknown} obj */
    krefOf: obj =>
      typeof obj === 'object' && obj ? krefOf.get(obj) : undefined,
  });
};

/**
 * The kernel names every exported object by a kref (`ko<n>`) and keeps, for
 * each vat, a c-list from that vat's vrefs to krefs (see liveslots.js for
 * vrefs). Every message a vat sends is translated through its own c-list:
 * an import vref it doesn't hold is refused, and an export vref names only
 * its own objects. So a vat can't forge a reference to anything it wasn't
 * given, and passing a reference from one vat to another is the kernel
 * adding a row to the receiver's c-list.
 *
 * The c-lists are in the kernel's SQLite, and durable objects are in each
 * vat's, so references between vats survive the eviction of a vat or of
 * the kernel. Parties outside (a client on the admin socket) get a c-list
 * that lasts as long as their session. The kernel's own objects are in
 * devices/: an object's key, `<prefix>:<rest>`, says which kind handles it.
 */
export class Kernel extends DurableObject {
  #krefs = makeKrefMarshal();
  /** @type {Record<string, KernelObjects>} each kind of the kernel's own objects, by key prefix */
  #objects;
  #bundles;
  #ingresses;
  #vatAdmins;
  #git;
  #nixStores;
  #fetchDevices;
  #lanDevices;
  #bootBundles;
  #entropy;
  /** @type {Promise<void> | undefined} this incarnation's {@link boot} */
  #booted;

  /** @param {DurableObjectState} ctx @param {Env} env */
  constructor(ctx, env) {
    super(ctx, env);
    const { sql } = ctx.storage;
    for (const statement of SCHEMA) sql.exec(statement);
    /** @type {KernelPowers} */
    const powers = harden({
      sql,
      next: name => this.#next(name),
      kernelObject: key => this.#kernelObject(key),
      standIn: this.#krefs.standIn,
      krefOf: this.#krefs.krefOf,
      keyOf: kref => this.#keyOf(kref),
    });
    this.#bundles = makeBundles(powers);
    this.#ingresses = makeIngresses(powers, {
      kernel: ctx.id.toString(),
      directory: env.DIRECTORY.getByName('directory'),
    });
    this.#vatAdmins = makeVatAdmins(powers, {
      bundles: this.#bundles,
      vats: {
        start: (hash, params) =>
          this.#startVat(hash, this.#krefs.toCapData(params)),
        upgrade: (vat, hash) => this.#upgradeVat(vat, hash),
        restart: vat => this.ctx.facets.abort(vat, Error('restarted')),
      },
    });
    this.#git = makeGit(powers, { worktree: env.GIT_WORKTREE });
    this.#nixStores = makeNixStores(powers, {
      store: env.NIX_STORE,
      bundles: this.#bundles,
    });
    this.#fetchDevices = makeFetchDevices(powers, {
      tag: 'FetchDevice',
      prefix: 'fetch',
      net: env.INTERNET,
    });
    this.#lanDevices = makeFetchDevices(powers, {
      tag: 'LanDevice',
      prefix: 'lan',
      net: env.LAN,
    });
    this.#bootBundles = makeBootBundles(powers, {
      boot: env.BOOT,
      bundles: this.#bundles,
    });
    this.#entropy = makeEntropy(powers, {
      // the Kernel is workerd's to construct, so randomness enters here, for
      // the entropy device to hand out
      // eslint-disable-next-line no-restricted-properties
      random: n => crypto.getRandomValues(new Uint8Array(n)),
    });
    this.#objects = {
      fetch: this.#fetchDevices,
      lan: this.#lanDevices,
      kernel: this.#ingresses,
      vatAdmin: this.#vatAdmins.vatAdmins,
      adminNode: this.#vatAdmins.adminNodes,
      bundle: this.#bundles,
      nixStore: this.#nixStores,
      gitWorktree: this.#git.worktrees,
      gitTree: this.#git.trees,
      gitReader: this.#git.readers,
      bootBundles: this.#bootBundles,
      entropy: this.#entropy,
    };
  }

  /** @param {string} name */
  #next(name) {
    return /** @type {number} INTEGER */ (
      this.ctx.storage.sql
        .exec(
          'INSERT INTO kcounter VALUES (?, 1) ON CONFLICT (name) DO UPDATE SET n = n + 1 RETURNING n',
          name,
        )
        .one().n
    );
  }

  /**
   * The kref of the kernel object `key`, made the first time it's asked for.
   *
   * @param {string} key
   */
  #kernelObject(key) {
    const { sql } = this.ctx.storage;
    const [row] = sql
      .exec(
        'SELECT kref FROM kobject WHERE owner = ? AND vref = ?',
        KERNEL,
        key,
      )
      .toArray();
    if (row) return /** @type {string} TEXT */ (row.kref);
    const kref = `ko${this.#next('kref')}`;
    sql.exec('INSERT INTO kobject VALUES (?, ?, ?)', kref, KERNEL, key);
    return kref;
  }

  /** @param {string} kref @returns {string | undefined} */
  #keyOf(kref) {
    const [row] = this.ctx.storage.sql
      .exec(
        'SELECT vref FROM kobject WHERE kref = ? AND owner = ?',
        kref,
        KERNEL,
      )
      .toArray();
    return /** @type {string | undefined} TEXT */ (row?.vref);
  }

  /**
   * A vat's c-list: the one table that gives its vrefs meaning.
   *
   * @param {string} vat
   * @returns {Clist}
   */
  #clist(vat) {
    const { sql } = this.ctx.storage;
    return {
      toKernel: vref => {
        const [row] = sql
          .exec('SELECT kref FROM clist WHERE vat = ? AND vref = ?', vat, vref)
          .toArray();
        if (row) return /** @type {string} TEXT */ (row.kref);
        if (!EXPORT.test(vref)) throw Error(`${vat} holds no ${vref}`);
        const kref = `ko${this.#next('kref')}`;
        sql.exec('INSERT INTO kobject VALUES (?, ?, ?)', kref, vat, vref);
        sql.exec('INSERT INTO clist VALUES (?, ?, ?)', vat, vref, kref);
        return kref;
      },
      toVat: kref => {
        const [row] = sql
          .exec('SELECT vref FROM clist WHERE vat = ? AND kref = ?', vat, kref)
          .toArray();
        if (row) return /** @type {string} TEXT */ (row.vref);
        const vref = `o-${this.#next(`import:${vat}`)}`;
        sql.exec('INSERT INTO clist VALUES (?, ?, ?)', vat, vref, kref);
        return vref;
      },
    };
  }

  /**
   * The facet running `vat`, started on its code if it isn't running.
   *
   * @param {string} vat
   * @returns {{ deliver: (vref: string, method: string, capdata: CapData) => Promise<CapData>, ready: () => Promise<void> }}
   */
  #vat(vat) {
    return /** @type {any} the facet's stub, whose methods are kvat-runtime.js's App's */ (
      this.ctx.facets.get(vat, () => {
        const hash = /** @type {string} TEXT */ (
          this.ctx.storage.sql
            .exec('SELECT hash FROM kvat WHERE vat = ?', vat)
            .one().hash
        );
        const worker = this.env.LOADER.get(
          `${this.ctx.id}:${vat}:${hash}`,
          () => {
            const { modules, ...compatibility } = this.#bundles.code(hash);
            return {
              ...compatibility,
              mainModule: 'runtime.js',
              modules: { 'runtime.js': KVAT_RUNTIME, ...modules },
              env: {
                syscall: this.ctx.exports.Syscall({
                  props: { kernel: this.ctx.id.toString(), vat },
                }),
              },
              globalOutbound: null,
            };
          },
        );
        return { class: worker.getDurableObjectClass('App') };
      })
    );
  }

  /**
   * Deliver to the object `kref`: to the vat that exports it, or to the
   * kind of kernel object its key names.
   *
   * @param {string} kref
   * @param {string} method
   * @param {CapData} kargs slots are krefs
   * @returns {Promise<CapData>} slots are krefs
   */
  async #deliver(kref, method, kargs) {
    const [obj] = this.ctx.storage.sql
      .exec('SELECT owner, vref FROM kobject WHERE kref = ?', kref)
      .toArray();
    if (!obj) throw Error(`no such object ${kref}`);
    const owner = /** @type {string} TEXT */ (obj.owner);
    const vref = /** @type {string} TEXT */ (obj.vref);
    if (owner === KERNEL) {
      const at = vref.indexOf(':');
      const kind = this.#objects[vref.slice(0, at)];
      if (!kind) throw Error(`no kind of kernel object for ${vref}`);
      const args = this.#krefs.fromCapData(kargs);
      return this.#krefs.toCapData(
        await kind.deliver(vref.slice(at + 1), method, args),
      );
    }
    const clist = this.#clist(owner);
    const result = await this.#vat(owner).deliver(
      vref,
      method,
      mapSlots(kargs, clist.toVat),
    );
    return mapSlots(result, clist.toKernel);
  }

  /**
   * One HTTP request, as data, for whoever serves the ingress `key`; `null`
   * when nobody does.
   *
   * @param {string} key
   * @param {HttpRequest} request
   * @returns {Promise<HttpResponse | null>}
   */
  async serveHttp(key, request) {
    const handler = this.#ingresses.handlerOf(key);
    if (!handler) return null;
    return this.#krefs.fromCapData(
      await this.#deliver(
        handler,
        'handle',
        this.#krefs.toCapData(harden([request])),
      ),
    );
  }

  /**
   * A message from a party, in its own vrefs, translated through its c-list
   * both ways.
   *
   * @param {Clist} clist
   * @param {string} vref
   * @param {string} method
   * @param {CapData} capdata
   */
  async #send(clist, vref, method, capdata) {
    const kref = clist.toKernel(vref);
    const result = await this.#deliver(
      kref,
      method,
      mapSlots(capdata, clist.toKernel),
    );
    return mapSlots(result, clist.toVat);
  }

  /** For {@link Syscall} only: a vat sends. @param {string} vat @param {string} vref @param {string} method @param {CapData} capdata */
  syscallSend(vat, vref, method, capdata) {
    return this.#send(this.#clist(vat), vref, method, capdata);
  }

  /** For {@link Syscall} only: the params a vat was created with, in its vrefs. @param {string} vat */
  syscallParams(vat) {
    const params = /** @type {string} TEXT */ (
      this.ctx.storage.sql
        .exec('SELECT params FROM kvat WHERE vat = ?', vat)
        .one().params
    );
    return mapSlots(JSON.parse(params), this.#clist(vat).toVat);
  }

  /**
   * Start a new vat on the bundle `hash`.
   *
   * @param {string} hash
   * @param {CapData} kparams slots are krefs
   * @param {(vat: string) => void} [made] records the new vat along with the kernel's own record of it, both or neither
   * @returns {Promise<{ vat: string, root: string }>} the root as a kref
   */
  async #startVat(hash, kparams, made) {
    const vat = `v${this.#next('vat')}`;
    this.ctx.storage.sql.exec(
      'INSERT INTO kvat VALUES (?, ?, ?)',
      vat,
      hash,
      JSON.stringify(kparams),
    );
    made?.(vat);
    const root = this.#clist(vat).toKernel('o+0');
    await this.#vat(vat).ready();
    return { vat, root };
  }

  /**
   * Run `vat` on the bundle `hash`: its next incarnation builds its root
   * from that code, which must define the kinds of the durable objects it
   * has made. If building the root fails, the vat goes back to its old code.
   *
   * @param {string} vat
   * @param {string} hash
   */
  async #upgradeVat(vat, hash) {
    const { sql } = this.ctx.storage;
    const [old] = sql
      .exec('SELECT hash FROM kvat WHERE vat = ?', vat)
      .toArray();
    if (!old) throw Error(`no such vat ${vat}`);
    sql.exec('UPDATE kvat SET hash = ? WHERE vat = ?', hash, vat);
    this.ctx.facets.abort(vat, Error('upgraded'));
    try {
      await this.#vat(vat).ready();
    } catch (e) {
      sql.exec('UPDATE kvat SET hash = ? WHERE vat = ?', old.hash, vat);
      this.ctx.facets.abort(vat, Error('upgrade failed'));
      throw e;
    }
  }

  /**
   * Start this kernel's boot vat, after SwingSet's bootstrap vat, on
   * `boot.js` in config.capnp's `boot` directory, or upgrade it if
   * `boot.js` changed since; then send it `start()`, which makes or
   * upgrades the vats it keeps. Once per incarnation of the kernel; a
   * kernel whose boot directory has no `boot.js` has no boot vat.
   *
   * The boot vat is the service's root of authority: it gets the boot
   * directory's bundles, a vatAdmin, an entropy device, the ingress for
   * the `app` socket, a nixStore, a git worktree, and a fetch and a LAN
   * device, to hand on as it sees fit.
   */
  boot() {
    this.#booted ??= this.#boot().catch(e => {
      this.#booted = undefined;
      throw e;
    });
    return this.#booted;
  }

  async #boot() {
    if (!(await this.#bootBundles.has('boot.js'))) return;
    const hash = this.#bundles.hashOf(
      await this.#bootBundles.install('boot.js'),
    );
    const { sql } = this.ctx.storage;
    const [row] = sql.exec('SELECT vat FROM kboot').toArray();
    let vat = /** @type {string | undefined} TEXT */ (row?.vat);
    if (!vat) {
      const { standIn } = this.#krefs;
      const params = harden({
        vatAdmin: standIn(this.#vatAdmins.make()),
        bundles: standIn(this.#bootBundles.make()),
        entropy: standIn(this.#entropy.make()),
        ingress: standIn(this.#ingresses.socket('app')),
        nixStore: standIn(this.#nixStores.make()),
        gitWorktree: standIn(this.#git.make()),
        fetch: standIn(this.#fetchDevices.make()),
        lan: standIn(this.#lanDevices.make()),
      });
      ({ vat } = await this.#startVat(
        hash,
        this.#krefs.toCapData(params),
        made => sql.exec('INSERT INTO kboot VALUES (?)', made),
      ));
    } else {
      const old = sql.exec('SELECT hash FROM kvat WHERE vat = ?', vat).one();
      if (old.hash !== hash) await this.#upgradeVat(vat, hash);
    }
    await this.#deliver(
      this.#clist(vat).toKernel('o+0'),
      'start',
      this.#krefs.toCapData(harden([])),
    );
  }

  /**
   * A request to the `app` socket, once the boot vat is up, for whoever it
   * has serve that socket's ingress; `null` when nobody does.
   *
   * @param {HttpRequest} request
   */
  async serveApp(request) {
    await this.boot();
    return this.serveHttp(this.#ingresses.socketKey('app'), request);
  }

  /**
   * A WebSocket here starts a Cap'n Web session whose main object is a
   * {@link KernelSession}.
   *
   * @param {Request} request
   */
  fetch(request) {
    const clist = makeSessionClist();
    /** @param {Promise<string> | string} kref */
    const toSession = async kref => clist.toVat(await kref);
    return newWorkersRpcResponse(
      request,
      new KernelSession({
        createVat: async (src, params) => {
          const hash = this.#bundles.hashOf(await this.#bundles.install(src));
          const { vat, root } = await this.#startVat(
            hash,
            mapSlots(params, clist.toKernel),
          );
          return {
            root: clist.toVat(root),
            adminNode: clist.toVat(this.#vatAdmins.adminNode(vat)),
          };
        },
        send: (vref, method, capdata) =>
          this.#send(clist, vref, method, capdata),
        vats: () =>
          this.ctx.storage.sql
            .exec(
              "SELECT k.vat, c.kref FROM kvat k JOIN clist c ON c.vat = k.vat AND c.vref = 'o+0' ORDER BY k.rowid",
            )
            .toArray()
            .map(({ vat, kref }) => ({
              root: clist.toVat(/** @type {string} TEXT */ (kref)),
              adminNode: clist.toVat(
                this.#vatAdmins.adminNode(/** @type {string} TEXT */ (vat)),
              ),
            })),
        makeIngress: labels => toSession(this.#ingresses.make(labels)),
        makeFetchDevice: () => toSession(this.#fetchDevices.make()),
        makeLanDevice: () => toSession(this.#lanDevices.make()),
        makeVatAdmin: () => toSession(this.#vatAdmins.make()),
        installBundle: src => toSession(this.#bundles.install(src)),
        makeNixStore: () => toSession(this.#nixStores.make()),
        makeGitWorktree: () => toSession(this.#git.make()),
      }),
    );
  }
}

/**
 * What the admin socket's session can do, in its own vrefs.
 *
 * @typedef {object} SessionPowers
 * @property {(src: string, params: CapData) => Promise<{ root: string, adminNode: string }>} createVat
 * @property {(vref: string, method: string, capdata: CapData) => Promise<CapData>} send
 * @property {() => { root: string, adminNode: string }[]} vats
 * @property {(labels: Record<string, string>) => Promise<string>} makeIngress
 * @property {() => Promise<string>} makeFetchDevice
 * @property {() => Promise<string>} makeLanDevice
 * @property {() => Promise<string>} makeVatAdmin
 * @property {(src: string) => Promise<string>} installBundle
 * @property {() => Promise<string>} makeNixStore
 * @property {() => Promise<string>} makeGitWorktree
 */

/**
 * What a client on the admin socket gets: create vats and kernel objects,
 * and send, in its own session's vrefs.
 */
export class KernelSession extends RpcTarget {
  #powers;

  /** @param {SessionPowers} powers */
  constructor(powers) {
    super();
    this.#powers = powers;
  }

  /**
   * A vat running `src`: its root, and its admin node, which can upgrade or
   * restart it.
   *
   * @param {string} src
   * @param {CapData} params
   */
  createVat(src, params) {
    return this.#powers.createVat(src, params);
  }

  /** @param {string} vref @param {string} method @param {CapData} capdata */
  send(vref, method, capdata) {
    return this.#powers.send(vref, method, capdata);
  }

  /**
   * Every vat's root and admin node, oldest first: how an admin finds its
   * vats again from a new session, after a crash, say. Whoever holds the
   * admin socket can make and upgrade vats anyway.
   */
  vats() {
    return this.#powers.vats();
  }

  /** An ingress for a mount at `labels`, as a vref of this session. @param {Record<string, string>} labels */
  makeIngress(labels) {
    return this.#powers.makeIngress(labels);
  }

  /** A fetch device, as a vref of this session. */
  makeFetchDevice() {
    return this.#powers.makeFetchDevice();
  }

  /** A LAN device, as a vref of this session: a fetch device for private addresses. */
  makeLanDevice() {
    return this.#powers.makeLanDevice();
  }

  /** A vatAdmin, as a vref of this session. */
  makeVatAdmin() {
    return this.#powers.makeVatAdmin();
  }

  /** Keep `src`; its bundleCap, as a vref of this session, is for a vatAdmin's `createVat`. @param {string} src */
  installBundle(src) {
    return this.#powers.installBundle(src);
  }

  /** A nixStore, as a vref of this session. */
  makeNixStore() {
    return this.#powers.makeNixStore();
  }

  /** A git worktree, as a vref of this session. */
  makeGitWorktree() {
    return this.#powers.makeGitWorktree();
  }
}

/**
 * A vat's only way out: `env.syscall`. Its props name the vat, and no
 * holder can change them, so a vat speaks only for itself.
 */
export class Syscall extends WorkerEntrypoint {
  #kernel() {
    const { KERNEL } = this.env;
    return KERNEL.get(KERNEL.idFromString(this.ctx.props.kernel));
  }

  /** @param {string} vref @param {string} method @param {CapData} capdata */
  send(vref, method, capdata) {
    return this.#kernel().syscallSend(
      this.ctx.props.vat,
      vref,
      method,
      capdata,
    );
  }

  params() {
    return this.#kernel().syscallParams(this.ctx.props.vat);
  }
}
