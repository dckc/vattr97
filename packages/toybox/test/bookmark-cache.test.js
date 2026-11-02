/** @file The bookmark cache's template rendering. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../kvats/bookmark-cache.js';

test("a template gets each value HTML-escaped, and refuses a name it isn't given", () => {
  assert.equal(
    render('<pre>{{latest}}</pre>', { latest: 'a < b & "c"' }),
    '<pre>a &lt; b &amp; &quot;c&quot;</pre>',
  );
  assert.throws(() => render('{{nope}}', {}), /wants nope/);
});
