/**
 * diigo-cache's cache vat: keeps your diigo bookmarks, read through one
 * WebApp narrowed to diigo's `load_user_items`, with the session cookie in
 * a header it sends but can't read. It holds nothing else: no cookie, no
 * other URL, no clock (each call that fetches says what time it is).
 *
 * Shared and private bookmarks are kept in separate stores, and the
 * public view (`viewer()`) closes over the shared one alone, so whoever
 * serves the public page can't reach a private bookmark.
 *
 * - `refresh(at)`: diigo's newest pages, until one holds nothing newer
 *   than what's kept
 * - `fill(at)`: the next pages of a walk through every page, a few per call
 * - `onSession()`: a facet for the session keeper, which calls
 *   `sessionSet(at)` after each new session: a refresh, then a fill step
 */
/**
 * @import { BuildRootObject, MapStore, Remote } from '../../../toybox/src/types.js';
 * @import { WebApp } from '../types.js';
 * @import { Item } from './items.js';
 */
import { rowOf, updatedOf, usernameOf } from './items.js';
import { dateOf, matches, parseQuery } from './query.js';

/** Items per diigo page: diigo's cap (asked for more, it sends 100). */
export const PAGE_SIZE = 100;
/** How many pages a refresh reads at most, when every one is new. */
export const REFRESH_PAGES = 5;
/** How many pages a fill step reads. */
export const FILL_PAGES = 20;
/** Bookmarks per public page. */
export const PER_PAGE = 50;

/**
 * The walk through every page: the next one to read, and diigo's count.
 *
 * @typedef {{ nextPage: number, pages?: number, done: boolean }} Walk
 */

/**
 * What the cache knows besides the bookmarks.
 *
 * @typedef {object} CacheState
 * @property {Walk} walk
 * @property {string} at when it last fetched, as the caller said
 * @property {number} total diigo's count of bookmarks
 * @property {number} newest the newest `updated_at` kept, in epoch seconds
 * @property {string} user whose bookmarks they are
 */

/**
 * @typedef {ReturnType<typeof buildRootObject>} DiigoCache the cache vat's root
 * @typedef {ReturnType<DiigoCache['viewer']>} DiigoViewer its public view: shared bookmarks, read-only
 * @typedef {ReturnType<DiigoCache['onSession']>} DiigoOnSession its hook for the session keeper
 * @typedef {ReturnType<DiigoViewer['query']>} Found what the public view found: bookmarks, or why the filter was refused
 */

/** @satisfies {BuildRootObject<{ source: Remote<WebApp> }>} */
export const buildRootObject = ({ E, Far, M, zone }, { source }) => {
  /** @type {MapStore<string, string>} shared items, by link_id, as JSON */
  const shared = zone.mapStore('shared');
  /** @type {MapStore<string, string>} private items, by link_id, as JSON */
  const hidden = zone.mapStore('private');
  /** @type {MapStore<keyof CacheState, CacheState[keyof CacheState]>} see {@link CacheState} */
  const state = zone.mapStore('state');

  /** @template {keyof CacheState} K @param {K} k @param {CacheState[K]} v */
  const put = (k, v) => (state.has(k) ? state.set(k, v) : state.init(k, v));
  /**
   * @template {keyof CacheState} K
   * @template D
   * @param {K} k
   * @param {D} dflt what it is before it's put
   * @returns {CacheState[K] | D}
   */
  const got = (k, dflt) =>
    state.has(k) ? /** @type {CacheState[K]} */ (state.get(k)) : dflt;

  /**
   * Page `n` (from 1) of diigo's bookmarks, newest updated first.
   *
   * @param {number} n
   * @returns {Promise<{ total: number, items: Item[] }>}
   */
  const page = async n => {
    // diigo counts pages from 0
    const text = await E(
      E(source).query({ sort: 'updated', count: PAGE_SIZE, page_num: n - 1 }),
    ).get();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw Error(
        `page ${n}: diigo answered other than JSON (is the session good?)`,
      );
    }
    if (!data || !Array.isArray(data.items) || typeof data.total !== 'number')
      throw Error(`page ${n}: expected { total, items } from diigo`);
    return data;
  };

  /**
   * Keep `items`, each in the store its privacy calls for (and out of the
   * other, should it have changed). Counts what was new or changed.
   *
   * @param {Item[]} items
   */
  const keep = items => {
    let added = 0;
    let changed = 0;
    for (const it of items) {
      const row = rowOf(it);
      if (!row) continue;
      const [into, out] = row.private ? [hidden, shared] : [shared, hidden];
      if (out.has(row.id)) out.delete(row.id);
      if (!into.has(row.id)) {
        into.init(row.id, row.json);
        added += 1;
      } else if (into.get(row.id) !== row.json) {
        into.set(row.id, row.json);
        changed += 1;
      }
      if (!state.has('user') && usernameOf(it)) put('user', usernameOf(it));
      if (updatedOf(it) > got('newest', 0)) put('newest', updatedOf(it));
    }
    return { added, changed };
  };

  /** @param {string} at */
  const checkAt = at => {
    if (typeof at !== 'string' || Number.isNaN(new Date(at).getTime()))
      throw Error('at: expected an ISO 8601 time');
  };

  /**
   * diigo's newest pages, until one holds nothing updated since the
   * newest kept, or the last page, or `pages` of them.
   *
   * @param {string} at now
   * @param {number} [pages]
   */
  const refresh = async (at, pages = REFRESH_PAGES) => {
    checkAt(at);
    const since = got('newest', 0);
    let added = 0;
    let changed = 0;
    let n = 0;
    for (;;) {
      n += 1;
      const { total, items } = await page(n);
      put('total', total);
      const kept = keep(items);
      added += kept.added;
      changed += kept.changed;
      const oldest = Math.min(...items.map(updatedOf));
      if (items.length === 0 || oldest <= since) break;
      if (n * PAGE_SIZE >= total || n >= pages) break;
    }
    put('at', at);
    return harden({ pages: n, added, changed });
  };

  /**
   * The next `pages` pages of the walk through every page.
   *
   * @param {string} at now
   * @param {number} [pages]
   */
  const fill = async (at, pages = FILL_PAGES) => {
    checkAt(at);
    /** @type {Walk} */
    let walk = got('walk', { nextPage: 1, done: false });
    if (walk.done) return harden({ ...walk, added: 0, changed: 0 });
    let added = 0;
    let changed = 0;
    for (let i = 0; i < pages && !walk.done; i += 1) {
      const { total, items } = await page(walk.nextPage);
      put('total', total);
      const kept = keep(items);
      added += kept.added;
      changed += kept.changed;
      const last = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const done = items.length === 0 || walk.nextPage >= last;
      walk = { nextPage: walk.nextPage + 1, pages: last, done };
      put('walk', harden(walk));
    }
    put('at', at);
    return harden({ ...walk, added, changed });
  };

  /** What's kept, and how far the walk has gone; no bookmark. */
  const status = () =>
    harden({
      shared: shared.getSize(),
      private: hidden.getSize(),
      total: got('total', undefined),
      at: got('at', undefined),
      user: got('user', undefined),
      walk: got('walk', { nextPage: 1, done: false }),
    });

  /** @param {{ added: number, changed: number }} r */
  const counted = ({ added, changed }) => `${added} new, ${changed} changed`;

  const makeOnSession = zone.exoClass(
    'DiigoOnSession',
    M.interface('DiigoOnSession', {
      sessionSet: M.callWhen(M.string()).returns(M.string()),
    }),
    () => ({}),
    {
      /**
       * After a new session: a refresh, then the next fill step; a
       * one-line summary, with counts, never a bookmark.
       *
       * @param {string} at
       */
      async sessionSet(at) {
        const r = await refresh(at);
        const parts = [
          `refreshed ${r.pages} page${r.pages === 1 ? '' : 's'}: ${counted(r)}`,
        ];
        if (!got('walk', { done: false }).done) {
          const f = await fill(at);
          parts.push(
            f.done
              ? `filled through page ${f.pages}: ${counted(f)}`
              : `filled to page ${f.nextPage - 1} of ${f.pages}: ${counted(f)}`,
          );
        }
        return parts.join('; ');
      },
    },
  );
  const onSession = zone.makeOnce('onSession', () => makeOnSession());

  const makeViewer = zone.exoClass(
    'DiigoViewer',
    M.interface('DiigoViewer', {
      query: M.call(M.recordOf(M.string(), M.string())).returns(M.record()),
    }),
    () => ({}),
    {
      /**
       * Shared bookmarks matching the public page's query params, newest
       * first, a page at a time (`page`, from 1). `days` and
       * `newer_than:` count back from the last fetch, since a vat has no
       * clock: the cache is no fresher than that anyway.
       *
       * @param {Record<string, string>} params
       */
      query(params) {
        const at = got('at', undefined);
        const now = new Date(at ?? 0);
        const query = parseQuery(params, now);
        const base = {
          user: got('user', undefined),
          at,
          complete: got('walk', { done: false }).done,
        };
        if ('error' in query) return harden({ ...base, error: query.error });
        /** @type {Item[]} */
        const all = shared.values().map(j => JSON.parse(j));
        const found = all
          .filter(it => matches(it, query))
          .sort(
            (a, b) => (dateOf(b, query.by) ?? 0) - (dateOf(a, query.by) ?? 0),
          );
        const pages = Math.max(1, Math.ceil(found.length / PER_PAGE));
        const n = Number.parseInt(params.page ?? '1', 10);
        const p = Number.isInteger(n) && n >= 1 ? Math.min(n, pages) : 1;
        return harden({
          ...base,
          by: query.by,
          matched: found.length,
          page: p,
          pages,
          items: found.slice((p - 1) * PER_PAGE, p * PER_PAGE),
        });
      },
    },
  );
  const viewer = zone.makeOnce('viewer', () => makeViewer());

  return Far('diigoCache', {
    refresh,
    fill,
    status,
    /** The public view: shared bookmarks only, read-only. */
    viewer: () => viewer,
    /** The session keeper's hook: `sessionSet(at)` alone. */
    onSession: () => onSession,
  });
};
