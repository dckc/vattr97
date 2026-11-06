/** @file The kernel: one Durable Object hosting many vats, each a facet on code installed at runtime, after SwingSet's kernel. */
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { RpcTarget, newWorkersRpcResponse } from 'capnweb';
import { Fail, q } from '@endo/errors';
import { makeMarshal } from '@endo/marshal';
import { Far } from '@endo/pass-style';
import VAT_RUNTIME from 'vat-runtime.txt';
import { makeBootBundles } from './kernel/boot.js';
import { TABLES as BUNDLE_TABLES, makeBundles } from './kernel/bundles.js';
import {
  TABLES as ENDOWMENT_TABLES,
  makeEndowments,
} from './kernel/endowments.js';
import { TABLES as INGRESS_TABLES, makeIngresses } from './kernel/ingress.js';
import { makeVatAdmins } from './kernel/vat-admin.js';
import { makeORM } from './orm.js';

/**
 * @import { Clist, Device, IngressKey, KernelKey, KernelObjects, KernelPowers, Kref, MakeDevices, VatId, WithTables } from './kernel/types.js';
 * @import { HttpRequest, HttpResponse } from './types.js';
 * @import { CapData, Vref } from './vat/types.js';
 * @import { ORM } from './orm.js';
 */

const TABLES = {
  // hash: of a bundle (kernel/bundles.js); params: CapData whose slots are krefs
  kvat: 'CREATE TABLE IF NOT EXISTS kvat (vat TEXT PRIMARY KEY, hash TEXT NOT NULL, params TEXT NOT NULL)',
  kobject:
    'CREATE TABLE IF NOT EXISTS kobject (kref TEXT PRIMARY KEY, owner TEXT NOT NULL, vref TEXT NOT NULL, UNIQUE (owner, vref))',
  clist:
    'CREATE TABLE IF NOT EXISTS clist (vat TEXT NOT NULL, vref TEXT NOT NULL, kref TEXT NOT NULL, PRIMARY KEY (vat, vref), UNIQUE (vat, kref))',
  kcounter:
    'CREATE TABLE IF NOT EXISTS kcounter (name TEXT PRIMARY KEY, n INTEGER NOT NULL)',
  // the boot vat, if this kernel has one
  kboot: 'CREATE TABLE IF NOT EXISTS kboot (vat TEXT NOT NULL)',
};

/**
 * @typedef {object} Tables
 * @property {{ vat: VatId, hash: string, params: string }} kvat
 * @property {{ kref: Kref, owner: typeof KERNEL, vref: KernelKey } | { kref: Kref, owner: VatId, vref: Vref }} kobject an object of the kernel's goes by its key, and a vat's by its vref
 * @property {{ vat: VatId, vref: Vref, kref: Kref }} clist
 * @property {{ name: string, n: number }} kcounter
 * @property {{ vat: VatId }} kboot
 */

const { entries, fromEntries, hasOwn, keys, values } = Object;

/** The owner of the kernel's own objects, in `kobject`. */
const KERNEL = 'kernel';

/** A vref a vat may export: its root, an ephemeral, or a durable object or kit facet. */
const EXPORT = /^o\+(0|e\d+|d(\d+|s|r)\/\d+(:[A-Za-z_$][\w$]*)?)$/;

/**
 * @template {string} From
 * @template {string} To
 * @param {CapData<From>} capdata
 * @param {(slot: From) => To} f
 * @returns {CapData<To>}
 */
const mapSlots = ({ body, slots }, f) => ({ body, slots: slots.map(f) });

/**
 * A party outside the kernel: its imports last as long as its session, and
 * it exports nothing.
 *
 * @returns {Clist}
 */
const makeSessionClist = () => {
  /** @type {Map<Vref, Kref>} */
  const byVref = new Map();
  /** @type {Map<Kref, Vref>} */
  const byKref = new Map();
  return {
    toKernel: vref => {
      const kref = byVref.get(vref);
      if (kref) return kref;
      if (vref.startsWith('o+')) throw Fail`a session exports nothing`;
      throw Fail`this session holds no ${q(vref)}`;
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
  /** @type {WeakMap<object, Kref>} */
  const krefOf = new WeakMap();
  /** @param {Kref} kref */
  const standIn = kref => {
    const obj = Far(`kref ${kref}`, {});
    krefOf.set(obj, kref);
    return obj;
  };
  /** @param {unknown} obj */
  const toKref = obj => {
    const kref = typeof obj === 'object' && obj && krefOf.get(obj);
    if (!kref) throw Fail`not a reference the kernel handed out`;
    return kref;
  };
  const marshal = makeMarshal(toKref, standIn, {
    serializeBodyFormat: 'smallcaps',
    errorTagging: 'off',
  });
  return harden({
    /** @param {unknown} val @returns {CapData<Kref>} */
    toCapData: val =>
      marshal.toCapData(
        harden(/** @type {any} marshal checks it's passable */ (val)),
      ),
    /** @param {CapData<Kref>} capdata @returns {any} whatever the sender sent */
    fromCapData: capdata => marshal.fromCapData(capdata),
    standIn,
    /** @param {unknown} obj */
    krefOf: obj =>
      typeof obj === 'object' && obj ? krefOf.get(obj) : undefined,
  });
};

/**
 * The kernel names every exported object by a kref (`ko<n>`) and keeps, for
 * each vat, a c-list from that vat's vrefs to krefs (see vat/liveslots.js for
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
 * kernel/, and its I/O devices' in devices/: an object's key,
 * `<prefix>:<rest>`, says which kind handles it.
 *
 * The kernel's I/O devices are whatever `makeDevices` makes: the worker's
 * entry module chooses them, and the kernel knows each only as a `Device`.
 *
 * @param {object} io
 * @param {MakeDevices} io.makeDevices the I/O devices, by name, made with
 *   the kernel's powers and the worker's bindings
 */
export const makeKernelClass = ({ makeDevices }) =>
  class Kernel extends DurableObject {
    #krefs = makeKrefMarshal();
    /** @type {ORM<Tables>} */
    #db;
    /** @type {Record<string, KernelObjects>} each kind of the kernel's own objects, by key prefix */
    #objects;
    #bundles;
    #ingresses;
    #vatAdmins;
    #bootBundles;
    #endowments;
    /** @type {Record<string, Device>} */
    #devices;
    /** @type {Promise<void> | undefined} this incarnation's {@link boot} */
    #booted;

    /** @param {DurableObjectState} ctx @param {Env} env */
    constructor(ctx, env) {
      super(ctx, env);
      const { sql } = ctx.storage;
      /** @param {Record<string, string>} tables */
      const ownTables = tables => {
        for (const ddl of values(tables)) sql.exec(ddl);
        return makeORM(sql, keys(tables));
      };
      this.#db = ownTables(TABLES);
      /** @type {KernelPowers} */
      const powers = harden({
        next: name => this.#next(name),
        kernelObject: key => this.#kernelObject(key),
        standIn: this.#krefs.standIn,
        krefOf: this.#krefs.krefOf,
        keyOf: kref => this.#keyOf(kref),
      });
      /** @type {WithTables} */
      const withTables = tables => harden({ ...powers, db: ownTables(tables) });
      this.#bundles = makeBundles(withTables(BUNDLE_TABLES));
      this.#ingresses = makeIngresses(withTables(INGRESS_TABLES), {
        kernel: ctx.id.toString(),
        directory: env.DIRECTORY.getByName('directory'),
      });
      this.#endowments = makeEndowments(withTables(ENDOWMENT_TABLES), {
        bindings: new Map(
          env.GRANTABLE.map(name => [
            name,
            /** @type {Fetcher} a binding the operator declared, by name */ (
              /** @type {Record<string, unknown>} */ (
                /** @type {unknown} */ (env)
              )[name]
            ),
          ]),
        ),
      });
      this.#vatAdmins = makeVatAdmins(powers, {
        bundles: this.#bundles,
        endowments: this.#endowments,
        vats: {
          start: (hash, params, grants) =>
            this.#startVat(hash, this.#krefs.toCapData(params), vat =>
              this.#endowments.record(vat, grants),
            ),
          upgrade: (vat, hash) => this.#upgradeVat(vat, hash),
          restart: vat => this.ctx.facets.abort(vat, Error('restarted')),
        },
      });
      this.#bootBundles = makeBootBundles(powers, {
        boot: env.BOOT,
        bundles: this.#bundles,
      });
      this.#devices = makeDevices(powers, {
        env,
        bundles: this.#bundles,
        withTables,
        // the Kernel is workerd's to construct, so randomness enters here, for
        // a device to hand out
        // eslint-disable-next-line no-restricted-properties
        random: n => crypto.getRandomValues(new Uint8Array(n)),
      });
      this.#objects = {
        kernel: this.#ingresses,
        vatAdmin: this.#vatAdmins.vatAdmins,
        adminNode: this.#vatAdmins.adminNodes,
        bundle: this.#bundles,
        bootBundles: this.#bootBundles,
        endowments: this.#endowments.directories,
        endowment: this.#endowments.endowments,
        ...fromEntries(
          values(this.#devices).flatMap(({ kinds }) => entries(kinds)),
        ),
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
     * @param {KernelKey} key
     * @returns {Kref}
     */
    #kernelObject(key) {
      const row = this.#db
        .lookup('kobject', { owner: KERNEL, vref: key })
        .get();
      if (row) return row.kref;
      /** @type {Kref} */
      const kref = `ko${this.#next('kref')}`;
      this.#db.insert('kobject', { kref, owner: KERNEL, vref: key });
      return kref;
    }

    /** @param {Kref} kref @returns {KernelKey | undefined} */
    #keyOf(kref) {
      const row = this.#db.lookup('kobject', { kref, owner: KERNEL }).get();
      return row?.owner === KERNEL ? row.vref : undefined;
    }

    /**
     * A vat's c-list: the one table that gives its vrefs meaning.
     *
     * @param {VatId} vat
     * @returns {Clist}
     */
    #clist(vat) {
      const db = this.#db;
      return {
        toKernel: vref => {
          const row = db.lookup('clist', { vat, vref }).get();
          if (row) return row.kref;
          if (!EXPORT.test(vref)) throw Fail`${q(vat)} holds no ${q(vref)}`;
          /** @type {Kref} */
          const kref = `ko${this.#next('kref')}`;
          db.insert('kobject', { kref, owner: vat, vref });
          db.insert('clist', { vat, vref, kref });
          return kref;
        },
        toVat: kref => {
          const row = db.lookup('clist', { vat, kref }).get();
          if (row) return row.vref;
          /** @type {Vref} */
          const vref = `o-${this.#next(`import:${vat}`)}`;
          db.insert('clist', { vat, vref, kref });
          return vref;
        },
      };
    }

    /**
     * The facet running `vat`, started on its code if it isn't running.
     *
     * @param {VatId} vat
     * @returns {{ deliver: (vref: Vref, method: string, capdata: CapData) => Promise<CapData>, ready: () => Promise<void> }}
     */
    #vat(vat) {
      return /** @type {any} the facet's stub, whose methods are vat/runtime.js's App's */ (
        this.ctx.facets.get(vat, () => {
          const { hash } = this.#db.lookup('kvat', { vat }).one();
          const worker = this.env.LOADER.get(
            `${this.ctx.id}:${vat}:${hash}`,
            () => {
              const { modules, ...compatibility } = this.#bundles.code(hash);
              return {
                ...compatibility,
                mainModule: 'runtime.js',
                modules: { 'runtime.js': VAT_RUNTIME, ...modules },
                env: {
                  syscall: this.ctx.exports.Syscall({
                    props: { kernel: this.ctx.id.toString(), vat },
                  }),
                  endowments: this.#endowments.of(vat),
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
     * @param {Kref} kref
     * @param {string} method
     * @param {CapData<Kref>} kargs
     * @returns {Promise<CapData<Kref>>}
     */
    async #deliver(kref, method, kargs) {
      const obj = this.#db.lookup('kobject', { kref }).get();
      if (!obj) throw Fail`no such object ${q(kref)}`;
      const { owner, vref } = obj;
      if (owner === KERNEL) {
        const at = vref.indexOf(':');
        const prefix = vref.slice(0, at);
        if (at < 0 || !Object.hasOwn(this.#objects, prefix))
          throw Fail`no kind of kernel object for ${q(vref)}`;
        const kind = this.#objects[prefix];
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
     * @param {IngressKey} key
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
     * @param {Vref} vref
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

    /** For {@link Syscall} only: a vat sends. @param {VatId} vat @param {Vref} vref @param {string} method @param {CapData} capdata */
    syscallSend(vat, vref, method, capdata) {
      return this.#send(this.#clist(vat), vref, method, capdata);
    }

    /** For {@link Syscall} only: the params a vat was created with, in its vrefs. @param {VatId} vat */
    syscallParams(vat) {
      const { params } = this.#db.lookup('kvat', { vat }).one();
      /** @type {CapData<Kref>} what {@link #startVat} recorded */
      const kparams = JSON.parse(params);
      return mapSlots(kparams, this.#clist(vat).toVat);
    }

    /**
     * Start a new vat on the bundle `hash`. If building its root fails, the
     * kernel forgets the vat, `made`'s record of it included.
     *
     * @param {string} hash
     * @param {CapData<Kref>} kparams
     * @param {(vat: VatId) => void} [made] records the new vat along with the kernel's own record of it, both or neither
     * @param {(vat: VatId) => void} [unmade] forgets what `made` recorded
     * @returns {Promise<{ vat: VatId, root: Kref }>}
     */
    async #startVat(hash, kparams, made, unmade) {
      /** @type {VatId} */
      const vat = `v${this.#next('vat')}`;
      this.#db.insert('kvat', { vat, hash, params: JSON.stringify(kparams) });
      made?.(vat);
      const root = this.#clist(vat).toKernel('o+0');
      try {
        await this.#vat(vat).ready();
      } catch (e) {
        this.ctx.facets.abort(vat, Error('failed to start'));
        unmade?.(vat);
        this.#db.lookup('kobject', { owner: vat }).delete();
        this.#db.lookup('clist', { vat }).delete();
        this.#db.lookup('kvat', { vat }).delete();
        throw e;
      }
      return { vat, root };
    }

    /**
     * Run `vat` on the bundle `hash`: its next incarnation builds its root
     * from that code, which must define the kinds of the durable objects it
     * has made. If building the root fails, the vat goes back to its old code.
     *
     * @param {VatId} vat
     * @param {string} hash
     */
    async #upgradeVat(vat, hash) {
      const row = this.#db.lookup('kvat', { vat });
      const old = row.get();
      if (!old) throw Fail`no such vat ${q(vat)}`;
      row.update({ hash });
      this.ctx.facets.abort(vat, Error('upgraded'));
      try {
        await this.#vat(vat).ready();
      } catch (e) {
        row.update({ hash: old.hash });
        this.ctx.facets.abort(vat, Error('upgrade failed'));
        throw e;
      }
    }

    /**
     * Start this kernel's boot vat, after SwingSet's bootstrap vat, on
     * `boot.js` in config.capnp's `boot` directory (or `boot`, a directory
     * bundle of several modules), or upgrade it if that changed since; then
     * send it `start()`, which makes or upgrades the vats it keeps. Once per
     * incarnation of the kernel; a kernel whose boot directory has neither
     * has no boot vat.
     *
     * The boot vat is the service's root of authority: it gets the boot
     * directory's bundles, a vatAdmin, the ingress for the `app` socket, the
     * endowments the operator made grantable, and one of each I/O device, to
     * hand on as it sees fit.
     */
    boot() {
      this.#booted ??= this.#boot().catch(e => {
        this.#booted = undefined;
        throw e;
      });
      return this.#booted;
    }

    async #boot() {
      const [name] = (
        await Promise.all(
          ['boot.js', 'boot'].map(async n =>
            (await this.#bootBundles.has(n)) ? [n] : [],
          ),
        )
      ).flat();
      if (!name) return;
      const hash = this.#bundles.hashOf(await this.#bootBundles.install(name));
      let vat = this.#db.query('kboot')[0]?.vat;
      if (!vat) {
        const { standIn } = this.#krefs;
        const params = harden({
          vatAdmin: standIn(this.#vatAdmins.make()),
          bundles: standIn(this.#bootBundles.make()),
          ingress: standIn(this.#ingresses.socket('app')),
          endowments: standIn(this.#endowments.make()),
          ...fromEntries(
            entries(this.#devices).map(([name, { make }]) => [
              name,
              standIn(make()),
            ]),
          ),
        });
        ({ vat } = await this.#startVat(
          hash,
          this.#krefs.toCapData(params),
          made => this.#db.insert('kboot', { vat: made }),
          unmade => this.#db.lookup('kboot', { vat: unmade }).delete(),
        ));
      } else {
        const old = this.#db.lookup('kvat', { vat }).one();
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
      /** @param {Promise<Kref> | Kref} kref */
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
                root: clist.toVat(/** @type {Kref} TEXT */ (kref)),
                adminNode: clist.toVat(
                  this.#vatAdmins.adminNode(/** @type {VatId} TEXT */ (vat)),
                ),
              })),
          makeIngress: labels => toSession(this.#ingresses.make(labels)),
          makeDevice: async name => {
            if (!hasOwn(this.#devices, name)) throw Error(`no device ${name}`);
            return toSession(this.#devices[name].make());
          },
          makeVatAdmin: () => toSession(this.#vatAdmins.make()),
          installBundle: src => toSession(this.#bundles.install(src)),
        }),
      );
    }
  };

/**
 * What the admin socket's session can do, in its own vrefs.
 *
 * @typedef {object} SessionPowers
 * @property {(src: string, params: CapData) => Promise<{ root: Vref, adminNode: Vref }>} createVat
 * @property {(vref: Vref, method: string, capdata: CapData) => Promise<CapData>} send
 * @property {() => { root: Vref, adminNode: Vref }[]} vats
 * @property {(labels: Record<string, string>) => Promise<Vref>} makeIngress
 * @property {(name: string) => Promise<Vref>} makeDevice
 * @property {() => Promise<Vref>} makeVatAdmin
 * @property {(src: string) => Promise<Vref>} installBundle
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

  /** @param {Vref} vref @param {string} method @param {CapData} capdata */
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

  /** The I/O device `name` makes (devices/index.js), as a vref of this session. @param {string} name */
  makeDevice(name) {
    return this.#powers.makeDevice(name);
  }

  /** A vatAdmin, as a vref of this session. */
  makeVatAdmin() {
    return this.#powers.makeVatAdmin();
  }

  /** Keep `src`; its bundleCap, as a vref of this session, is for a vatAdmin's `createVat`. @param {string} src */
  installBundle(src) {
    return this.#powers.installBundle(src);
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

  /** @param {Vref} vref @param {string} method @param {CapData} capdata */
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
