/**
 * @file Pages a host serves, as the gateway passes them on. A page's swiss
 * number goes only in a link's fragment or a request's body, never in a
 * path, where logs, history, and Referer headers would keep it: the link
 * is `/page#page=<swiss>`, whose script POSTs the number to `/s/`, and
 * every form on a served page posts back there with the number in a hidden
 * field, its path in a field named `path`.
 */

/** Where a served page's forms post. */
export const SERVED = '/s/';

/**
 * A served page's request, from a form's body: the page's swiss number,
 * the path it asks for (`/` if none), and the other fields, as labels.
 *
 * @param {string} body `application/x-www-form-urlencoded`
 * @returns {{ page: string, path: string, labels: Record<string, string> }}
 */
export const pageRequestOf = body => {
  /** @type {Record<string, string>} */
  const labels = {};
  let page = '';
  let path = '/';
  for (const [k, v] of new URLSearchParams(body)) {
    if (k === 'page') page = v;
    else if (k === 'path') path = v.startsWith('/') ? v : `/${v}`;
    else labels[k] = v;
  }
  return { page, path, labels };
};

/** @param {string} s */
const attr = s =>
  s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

/**
 * `html` with each form posting back to the served page: a form's own
 * method and action, and any button's `formaction` or `formmethod`, give
 * way to POST to {@link SERVED}, and a hidden field carries the page's
 * number. A parser keeps the first of two attributes of the same name, so
 * the ones put first win.
 *
 * @param {string} html
 * @param {string} page the page's swiss number
 */
export const postingBack = (html, page) =>
  html
    .replace(/\sform(?:action|method)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /<form\b([^>]*)>/gi,
      `<form method="post" action="${SERVED}"$1><input type="hidden" name="page" value="${attr(page)}">`,
    );

/** The loader at `/page`: its script reads the number from the fragment, and posts it. */
export const LOADER = `<!doctype html>
<meta charset="utf-8">
<title>page</title>
<form id="go" method="post" action="${SERVED}"><input type="hidden" name="page"><noscript>This link needs script to open its page.</noscript></form>
<script src="/page.js"></script>
`;

export const LOADER_SCRIPT = `'use strict';
const page = new URLSearchParams(location.hash.slice(1)).get('page');
if (page) {
  const go = document.getElementById('go');
  go.elements.page.value = page;
  go.submit();
} else document.body.append('not a page link: no #page=');
`;
