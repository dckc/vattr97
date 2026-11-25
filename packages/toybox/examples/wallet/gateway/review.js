/**
 * @file Reviewing a proposed definition before endowing it: its modules'
 * source, colorized by highlight.js, each one also openable in a window
 * of its own. The wallet and blocks pages both include it.
 * @see REVIEW_SCRIPT
 */

/** highlight.js 11.9.0, from cdnjs, pinned by its hash. */
export const HLJS = {
  src: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
  integrity:
    'sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp',
};

/** The page's script tag for highlight.js. */
export const HLJS_TAG = `<script src="${HLJS.src}" integrity="${HLJS.integrity}" crossorigin="anonymous"></script>`;

/** Colors for highlight.js's classes, and the layout of a module's source. */
export const REVIEW_CSS = `
  pre.source { background: #fafafa; border: 1px solid #ddd; padding: .5em; overflow-x: auto; white-space: pre; font-size: 13px; line-height: 1.35; }
  .hljs-keyword, .hljs-built_in { color: #a626a4; } .hljs-string, .hljs-regexp { color: #50a14f; }
  .hljs-number, .hljs-literal { color: #986801; } .hljs-comment { color: #8a8a8a; font-style: italic; }
  .hljs-title, .hljs-title\\.function_ { color: #4078f2; } .hljs-params, .hljs-variable { color: #c18401; }
  .hljs-attr, .hljs-property { color: #e45649; } .hljs-doctag { color: #0184bc; }
  .hljs-subst { color: #383a42; background: #eef3fb; }
`;

/**
 * Browser code for both pages: `sourceView(path, source)` answers a
 * module's source, shown open, colorized when highlight.js loaded and
 * plain text when it didn't, with a button that opens it in a window of
 * its own.
 */
export const REVIEW_SCRIPT = `
const REVIEW_CSS = ${JSON.stringify(REVIEW_CSS)};
const colorized = source => {
  const code = document.createElement('code');
  code.className = 'language-javascript';
  code.textContent = source;
  if (globalThis.hljs) globalThis.hljs.highlightElement(code);
  const pre = document.createElement('pre');
  pre.className = 'source';
  pre.append(code);
  return pre;
};
// a window of its own, with no script: the colorized source, copied in
const popOut = (path, source) => {
  const w = window.open('', '_blank', 'width=900,height=800');
  if (!w) throw Error('the browser blocked the window');
  w.document.title = path;
  const style = w.document.createElement('style');
  style.textContent = 'body { margin: 0; font: 15px system-ui, sans-serif; } h1 { font-size: 1em; padding: .5em; margin: 0; } pre.source { margin: 0; border: 0; }' + REVIEW_CSS;
  const h = w.document.createElement('h1');
  h.textContent = path;
  w.document.head.append(style);
  w.document.body.replaceChildren(h, w.document.importNode(colorized(source), true));
};
const sourceView = (path, source) => {
  const details = document.createElement('details');
  details.open = true;
  const summary = document.createElement('summary');
  const out = document.createElement('button');
  out.type = 'button';
  out.textContent = 'pop out';
  out.onclick = ev => { ev.preventDefault(); popOut(path, source); };
  summary.append(path + ' (' + source.length + ' bytes) ', out);
  details.append(summary, colorized(source));
  return details;
};
`;
