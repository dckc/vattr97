/**
 * A bookmark cache: refreshes from the WebApp it was created with, keeps
 * what it got last, durably, and serves it as a page at its ingress,
 * rendered from a template in a git tree. It reads the site through that
 * WebApp alone: it holds no cookie to rotate, no path outside the app's,
 * and no way to read from anywhere else.
 */
/** @import { BuildRootObject, HttpResponse, MapStore, Remote } from '../types.js' */

const ESCAPES = /** @type {Record<string, string>} */ ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

/**
 * `template` with each `{{name}}` replaced by `values[name]`, HTML-escaped;
 * a name with no value is refused.
 *
 * @param {string} template
 * @param {Record<string, string>} values
 */
export const render = (template, values) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!Object.hasOwn(values, name))
      throw Error(`the template wants ${name}, which isn't given`);
    return values[name].replace(/[&<>"']/g, c => ESCAPES[c]);
  });

/** @type {BuildRootObject<{ source: Remote, ingress: Remote, templates: Remote }>} */
export const buildRootObject = (
  { E, Far, M, zone },
  { source, ingress, templates },
) => {
  /** @type {MapStore<string, string>} */
  const cache = zone.mapStore('cache');

  const makePage = zone.exoClass(
    'BookmarksPage',
    M.interface('BookmarksPage', {
      handle: M.call(M.record()).returns(M.promise()),
    }),
    () => ({}),
    {
      /** @returns {Promise<HttpResponse>} */
      async handle() {
        const template = await E(templates).read('templates/bookmarks.html');
        return {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: render(template, {
            latest: cache.has('latest') ? cache.get('latest') : '(none yet)',
          }),
        };
      },
    },
  );
  zone.makeOnce('page', () => {
    const page = makePage();
    E(ingress).serve(page);
    return page;
  });

  return Far('bookmarkCache', {
    /** Fetch through the source and keep the result. */
    async refresh() {
      /** @type {string} */
      const text = await E(source).get();
      if (cache.has('latest')) cache.set('latest', text);
      else cache.init('latest', text);
      return text;
    },
    /** What the last refresh got. */
    latest: () => cache.get('latest'),
  });
};
