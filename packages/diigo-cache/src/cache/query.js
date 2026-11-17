/**
 * @file the public page's filters: date windows and search over a cache's
 * stored items. Ported from capsite's diigo-cache (src/query.ts).
 */

/**
 * A filter as devs write it (`{ days: 7, q: "#weekly" }`); the public
 * page's query params map onto these fields one-to-one (strings, with ""
 * meaning absent). Dates are `yyyy-mm-dd` (gmail's `yyyy/mm/dd` too);
 * periods are `2025`, `2025-03`, `2025-Q1`, or ISO week `2025-W01`. Time
 * is UTC throughout; ISO weeks start Monday, keeping a weekend together.
 *
 * @typedef {object} FilterSpec
 * @property {number | string} [days] the last N days, counted back from now (1–3650)
 * @property {string} [after] inclusive lower bound, from 00:00Z
 * @property {string} [before] exclusive upper bound, at 00:00Z
 * @property {string} [in] a named period: shorthand for its after/before pair
 * @property {'updated' | 'created' | ''} [by] which date the window, the listed date, and the sort use
 * @property {string} [q] words, phrases, tags, and operators
 */

/** One search term; `negated` for a leading `-`. @typedef {{ text: string, negated: boolean }} Term */

/**
 * A parsed filter; an empty one (no window, no terms) filters nothing.
 *
 * @typedef {object} Query
 * @property {'updated' | 'created'} by default `updated`, diigo's own order
 * @property {Date} [after] inclusive lower bound
 * @property {Date} [before] exclusive upper bound
 * @property {Term[]} words each must appear in title, description, or url
 * @property {Term[]} tags exact, case-insensitive match against the item's tags
 */

/** A refused filter: the message is safe to show and log. @typedef {{ error: string }} QueryError */

const DAY_MS = 24 * 60 * 60 * 1000;

/** thrown inside {@link toQuery}, returned as a {@link QueryError} */
class Refused extends Error {}

/** `yyyy-mm-dd` or `yyyy/mm/dd` as 00:00Z of that UTC day */
/** @param {string} text @param {string} what @returns {Date} */
function parseDay(text, what) {
  const m = /^(\d{4})([-/])(\d{2})\2(\d{2})$/.exec(text);
  const d =
    m && new Date(Date.UTC(Number(m[1]), Number(m[3]) - 1, Number(m[4])));
  if (
    !m ||
    !d ||
    d.getUTCMonth() !== Number(m[3]) - 1 ||
    d.getUTCDate() !== Number(m[4])
  ) {
    throw new Refused(`${what}: expected a date as yyyy-mm-dd`);
  }
  return d;
}

/** Monday 00:00Z of ISO week 1 of `year` (the week holding January 4) */
/** @param {number} year @returns {number} */
function isoWeekOne(year) {
  const jan4 = Date.UTC(year, 0, 4);
  const weekday = new Date(jan4).getUTCDay() || 7;
  return jan4 - (weekday - 1) * DAY_MS;
}

/** a named period as its half-open [after, before) window */
/** @param {string} text @param {string} what @returns {[Date, Date]} */
function parsePeriod(text, what) {
  const refuse = () =>
    new Refused(
      `${what}: expected a period as 2025, 2025-03, 2025-Q1, or 2025-W01`,
    );
  let m;
  if ((m = /^(\d{4})$/.exec(text))) {
    const y = Number(m[1]);
    return [new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1))];
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(text))) {
    const [y, mo] = [Number(m[1]), Number(m[2])];
    if (mo < 1 || mo > 12) throw refuse();
    return [new Date(Date.UTC(y, mo - 1, 1)), new Date(Date.UTC(y, mo, 1))];
  }
  if ((m = /^(\d{4})-Q([1-4])$/.exec(text))) {
    const [y, q] = [Number(m[1]), Number(m[2])];
    return [
      new Date(Date.UTC(y, 3 * (q - 1), 1)),
      new Date(Date.UTC(y, 3 * q, 1)),
    ];
  }
  if ((m = /^(\d{4})-W(\d{2})$/.exec(text))) {
    const [y, w] = [Number(m[1]), Number(m[2])];
    const weeks = (isoWeekOne(y + 1) - isoWeekOne(y)) / (7 * DAY_MS);
    if (w < 1 || w > weeks) throw refuse();
    const monday = isoWeekOne(y) + (w - 1) * 7 * DAY_MS;
    return [new Date(monday), new Date(monday + 7 * DAY_MS)];
  }
  throw refuse();
}

/** gmail's `newer_than:` amount (`7d`, `2w`, `1m`, `1y`) counted back from
 * `now`; months and years are calendar steps */
/** @param {string} text @param {Date} now @returns {Date} */
function parseNewerThan(text, now) {
  const m = /^(\d{1,4})([dwmy])$/.exec(text);
  if (!m || Number(m[1]) < 1)
    throw new Refused('newer_than: expected an amount like 7d, 2w, 1m, or 1y');
  const n = Number(m[1]);
  const d = new Date(now.getTime());
  if (m[2] === 'd') d.setTime(now.getTime() - n * DAY_MS);
  if (m[2] === 'w') d.setTime(now.getTime() - 7 * n * DAY_MS);
  if (m[2] === 'm') d.setUTCMonth(d.getUTCMonth() - n);
  if (m[2] === 'y') d.setUTCFullYear(d.getUTCFullYear() - n);
  return d;
}

/** `days` as a whole number from 1 to 3650 */
/** @param {number | string} days @returns {number} */
function parseDays(days) {
  const n =
    typeof days === 'number' ? days : /^\d+$/.test(days) ? Number(days) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 3650)
    throw new Refused('days: expected a whole number from 1 to 3650');
  return n;
}

/**
 * resolve a filter: fields and `q` operators combine; a bound given twice
 * (by fields, operators, or both) is refused, as is an empty window.
 *
 * `q` takes the operators large audiences know: gmail's `after:`,
 * `before:`, `newer_than:7d`; Slack's `during:` (alias `in:`); GitHub's
 * `created:`/`updated:` with a period; plus words, `"phrases"`,
 * `#tag`/`tag:tag`, and `-` negation. Every window is half-open: `after`
 * inclusive from 00:00Z, `before` exclusive at 00:00Z (so no inclusive
 * GitHub `a..b` ranges).
 *
 * @see https://mailmeteor.com/blog/search-gmail-by-date
 * @see https://slack.com/help/articles/202528808
 * @see https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories
 *
 * @param {FilterSpec} spec
 * @param {Date} now the clock `days`/`newer_than` count back from (passed
 * in, not read ambiently: a vat has none, and tests pin it)
 * @returns {Query | QueryError}
 */
export function toQuery(spec, now) {
  try {
    return resolve(spec, now);
  } catch (err) {
    if (err instanceof Refused) return { error: err.message };
    throw err;
  }
}

/** @param {FilterSpec} spec @param {Date} now @returns {Query} */
function resolve(spec, now) {
  /** @type {Term[]} */
  const words = [];
  /** @type {Term[]} */
  const tags = [];
  /** @type {{ value: Query['by'], from: string } | undefined} */
  let by;
  /** @type {{ value: Date, from: string } | undefined} */
  let after;
  /** @type {{ value: Date, from: string } | undefined} */
  let before;

  /** @param {Query['by']} value @param {string} from */
  const setBy = (value, from) => {
    if (by && by.value !== value)
      throw new Refused(`${by.from} and ${from} name different dates`);
    by = { value, from };
  };
  /** @param {Date} value @param {string} from */
  const setAfter = (value, from) => {
    if (after)
      throw new Refused(
        `${after.from} and ${from} both set where the window starts`,
      );
    after = { value, from };
  };
  /** @param {Date} value @param {string} from */
  const setBefore = (value, from) => {
    if (before)
      throw new Refused(
        `${before.from} and ${from} both set where the window ends`,
      );
    before = { value, from };
  };
  /** @param {[Date, Date]} period @param {string} from */
  const setPeriod = ([lo, hi], from) => {
    setAfter(lo, from);
    setBefore(hi, from);
  };

  /** @template {string | number} T @param {T | undefined} v @returns {v is T} */
  const present = v => v !== undefined && v !== '';
  if (present(spec.by)) {
    if (spec.by !== 'updated' && spec.by !== 'created')
      throw new Refused('by: expected updated or created');
    setBy(spec.by, `by=${spec.by}`);
  }
  if (present(spec.days))
    setAfter(new Date(now.getTime() - parseDays(spec.days) * DAY_MS), 'days');
  if (present(spec.after)) setAfter(parseDay(spec.after, 'after'), 'after');
  if (present(spec.before))
    setBefore(parseDay(spec.before, 'before'), 'before');
  if (present(spec.in)) setPeriod(parsePeriod(spec.in, 'in'), 'in');

  for (const m of (spec.q ?? '').matchAll(/(-?)"([^"]*)"|(\S+)/g)) {
    if (m[2] !== undefined) {
      if (m[2].trim())
        words.push({ text: m[2].trim().toLowerCase(), negated: m[1] === '-' });
      continue;
    }
    const token = m[3];
    const negated = token.length > 1 && token.startsWith('-');
    const body = negated ? token.slice(1) : token;
    const op = /^([a-z_]+):(.+)$/i.exec(body);
    const name = op?.[1].toLowerCase();
    const arg = op?.[2] ?? '';
    const windowOp = [
      'after',
      'before',
      'newer_than',
      'during',
      'in',
      'created',
      'updated',
    ];
    if (name && windowOp.includes(name) && negated)
      throw new Refused(`${name}: can't be negated`);
    if (name === 'after') setAfter(parseDay(arg, 'after:'), 'after:');
    else if (name === 'before') setBefore(parseDay(arg, 'before:'), 'before:');
    else if (name === 'newer_than')
      setAfter(parseNewerThan(arg, now), 'newer_than:');
    else if (name === 'during' || name === 'in')
      setPeriod(parsePeriod(arg, `${name}:`), `${name}:`);
    else if (name === 'created' || name === 'updated') {
      setBy(name, `${name}:`);
      setPeriod(parsePeriod(arg, `${name}:`), `${name}:`);
    } else if (name === 'tag') tags.push({ text: arg.toLowerCase(), negated });
    else if (body.length > 1 && body.startsWith('#'))
      tags.push({ text: body.slice(1).toLowerCase(), negated });
    else words.push({ text: body.toLowerCase(), negated });
  }

  if (after && before && after.value.getTime() >= before.value.getTime()) {
    throw new Refused(
      `the window is empty: ${after.from} is not earlier than ${before.from}`,
    );
  }
  /** @type {Query} */
  const query = { by: by?.value ?? 'updated', words, tags };
  if (after) query.after = after.value;
  if (before) query.before = before.value;
  return query;
}

/**
 * {@link toQuery} over the public page's query params, as an ingress
 * hands them over (its labels).
 *
 * @param {Record<string, string>} params
 * @param {Date} now
 */
export function parseQuery(params, now) {
  const field = (/** @type {string} */ name) =>
    Object.hasOwn(params, name) ? params[name] : '';
  const by = field('by');
  return toQuery(
    {
      days: field('days'),
      after: field('after'),
      before: field('before'),
      in: field('in'),
      by: /** @type {FilterSpec['by']} */ (by),
      q: field('q'),
    },
    now,
  );
}

/** does the query filter anything? (an empty one lists diigo's pages as stored) */
/** @param {Query} query */
export function isEmpty(query) {
  return (
    !query.after &&
    !query.before &&
    !query.words.length &&
    !query.tags.length &&
    query.by === 'updated'
  );
}

/** the item's date that `by` names, in epoch seconds (diigo's unit), or
 * undefined when it carries none */
/** @param {Record<string, unknown>} item @param {Query['by']} by @returns {number | undefined} */
export function dateOf(item, by) {
  const secs = by === 'created' ? item.created_at : item.updated_at;
  return typeof secs === 'number' && Number.isFinite(secs) ? secs : undefined;
}

/** does `item` fall in the window and satisfy every term? */
/** @param {Record<string, unknown>} item @param {Query} query */
export function matches(item, query) {
  if (query.after || query.before) {
    const secs = dateOf(item, query.by);
    if (secs === undefined) return false;
    if (query.after && secs * 1000 < query.after.getTime()) return false;
    if (query.before && secs * 1000 >= query.before.getTime()) return false;
  }
  const text = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : '');
  // fields joined by newline, so a phrase never spans two of them
  const haystack = [item.title, item.description, item.url]
    .map(text)
    .join('\n')
    .toLowerCase();
  if (!query.words.every(w => haystack.includes(w.text) !== w.negated))
    return false;
  const itemTags = new Set(
    text(item.tags)
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean),
  );
  return query.tags.every(t => itemTags.has(t.text) !== t.negated);
}
