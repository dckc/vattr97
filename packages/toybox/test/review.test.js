/** @file The colors a definition's source is reviewed in. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_CSS } from '../examples/wallet/gateway/review.js';

test("a template literal's substitutions aren't colored as the string around them", () => {
  // highlight.js marks `${...}` as .hljs-subst inside .hljs-string
  assert.match(REVIEW_CSS, /\.hljs-subst\s*\{[^}]*color:/);
});
