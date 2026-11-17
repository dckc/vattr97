/**
 * @file The public page's HTML: an h-feed of h-entry bookmarks, after
 * capsite's diigo-cache, whose markup is the page's API for other sites.
 * Pure: it renders what the viewer answered.
 *
 * @import { Found } from '../cache/cache.js';
 *
 * @see https://microformats.org/wiki/h-entry
 * @see https://indieweb.org/bookmark
 */

/** @param {string} s */
export const esc = s =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** The `days` choices the filter form offers. */
const DAY_PRESETS = ['7', '14', '30', '90', '365'];

/**
 * The filter form, echoing the request's filter.
 *
 * @param {string} here
 * @param {Record<string, string>} params
 */
export const filterForm = (here, params) => {
  const field = (/** @type {string} */ name) =>
    esc(Object.hasOwn(params, name) ? params[name] : '');
  const days = params.days ?? '';
  const presets =
    DAY_PRESETS.includes(days) || !days ? DAY_PRESETS : [...DAY_PRESETS, days];
  const option = (
    /** @type {string} */ value,
    /** @type {string} */ label,
    /** @type {string} */ current,
  ) =>
    `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
  const by = params.by ?? '';
  return `<form method="get" action="${esc(here)}">
<p><label>last <select name="days">${option('', 'any', days)}${presets.map(n => option(n, `${n} days`, days)).join('')}</select></label>
<label>or after <input type="date" name="after" value="${field('after')}"></label>
<label>before <input type="date" name="before" value="${field('before')}"></label>
<label>or in <input name="in" size="9" placeholder="2026-W41" value="${field('in')}"></label>
<label>by <select name="by">${option('updated', 'updated', by)}${option('created', 'created', by)}</select></label></p>
<p><label>search <input type="search" name="q" size="40" value="${field('q')}"></label>
<button type="submit">filter</button></p>
<p><small>Dates and periods (2026, 2026-03, 2026-Q1, 2026-W41) are UTC. Search takes
words, "phrases", #tags, -negation, and after:, before:, newer_than:7d, during:2026-Q1, created:2026.
"Last N days" counts back from the last refresh.</small></p>
</form>`;
};

/**
 * Bookmarks as a list, each led by its `by` date: an `h-feed` of
 * `h-entry` bookmarks (`u-bookmark-of`, `p-name`, `p-summary`,
 * `p-category` per tag, `dt-published` when bookmarked, `dt-updated`
 * when last edited). Tag links search this page by tag.
 *
 * @param {Record<string, unknown>[]} items
 * @param {'updated' | 'created'} by
 * @param {string} here
 */
export const itemList = (items, by, here) => {
  const time = (
    /** @type {Record<string, unknown>} */ it,
    /** @type {'updated' | 'created'} */ which,
    /** @type {boolean} */ hide,
  ) => {
    const secs = which === 'created' ? it.created_at : it.updated_at;
    if (typeof secs !== 'number' || !Number.isFinite(secs))
      return hide ? '' : '(no date)';
    const when = new Date(secs * 1000).toISOString();
    const cls = which === 'created' ? 'dt-published' : 'dt-updated';
    return `<time class="${cls}" datetime="${when}"${hide ? ' hidden>' : `>${when}`}</time>`;
  };
  const text = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : '');
  const entries = items.map(it => {
    const url = text(it.url);
    const title = text(it.title) || url;
    const desc = text(it.description)
      ? `<br><small class="p-summary">${esc(text(it.description))}</small>`
      : '';
    const href = /^https?:\/\//i.test(url) ? url : '#';
    const tags = text(it.tags)
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
      .map(
        t =>
          ` <a class="p-category" href="${esc(`${here}?q=${encodeURIComponent(`#${t}`)}`)}">${esc(t)}</a>`,
      )
      .join('');
    const other = by === 'created' ? 'updated' : 'created';
    return `<li class="h-entry">${time(it, by, false)} <a class="u-bookmark-of p-name" href="${esc(href)}">${esc(title)}</a>${tags}${desc}${time(it, other, true)}</li>`;
  });
  return `<ol class="h-feed">\n${entries.join('\n')}\n</ol>`;
};

/**
 * The public page: what the viewer found, with the filter form and links
 * to the pages before and after.
 *
 * @param {string} user
 * @param {Record<string, string>} params
 * @param {Found} found the viewer's answer
 */
export const publicPage = (user, params, found) => {
  const here = `/public/${encodeURIComponent(user)}`;
  const caveat = found.complete
    ? ''
    : ' Not every diigo page is stored yet, so some may be missing.';
  const asOf = found.at ? ` As of ${esc(found.at)}.` : ' Not fetched yet.';
  let content;
  if ('error' in found) {
    content = `${filterForm(here, params)}\n<p><em>${esc(found.error)}</em></p>`;
  } else {
    const kept = Object.entries(params).filter(
      ([k, v]) => k !== 'page' && v !== '',
    );
    const href = (/** @type {number} */ n) =>
      `${here}?${new URLSearchParams([...kept, ['page', String(n)]])}`;
    const nav = (/** @type {number} */ n, /** @type {string} */ label) =>
      n >= 1 && n <= found.pages
        ? `<a rel="${n < found.page ? 'prev' : 'next'}" href="${esc(href(n))}">${label}</a>`
        : `<span>${label}</span>`;
    const status = found.matched
      ? `${found.matched} bookmark${found.matched === 1 ? '' : 's'}, page ${found.page} of ${found.pages}, newest ${found.by} first.`
      : 'No bookmarks match.';
    content = `<p><strong>${esc(status)}</strong>${asOf}${caveat}</p>
${filterForm(here, params)}
<p>${nav(found.page - 1, '← prev')} ${nav(found.page + 1, 'next →')}</p>
${itemList(found.items, found.by, here)}`;
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(user)}'s shared bookmarks</title>
<style>
:root { color-scheme: light dark; }
body { font: 15px/1.45 system-ui, sans-serif; margin: 0 auto; padding: 16px; max-width: 760px; }
li.h-entry { margin: 6px 0; }
time { font-variant-numeric: tabular-nums; }
</style></head>
<body>
<h1>${esc(user)}'s shared bookmarks</h1>
${content}
</body></html>`;
};
