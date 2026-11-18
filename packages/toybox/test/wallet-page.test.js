/** @file The wallet's page: its script parses, so a page edit that breaks it fails here, not in the browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE, SCRIPT } from '../examples/wallet/gateway/page.js';

test("the wallet page's script parses, and the page loads it", () => {
  // parse only: Function compiles the body without running it
  assert.doesNotThrow(() => Function(SCRIPT));
  assert.match(PAGE, /<script src="\/wallet\.js"><\/script>/);
});

test('a secret never shows: the made link and the secret field are password inputs', () => {
  assert.match(PAGE, /<input type="password" id="secret"/);
  assert.match(PAGE, /<input type="password" id="secretIn"/);
  assert.doesNotMatch(SCRIPT, /show\('link', location\.origin/);
});

test('an answer that is text can be saved as a file', () => {
  assert.match(PAGE, /<button id="save">/);
  assert.match(SCRIPT, /offerSave\(answer/);
});

test('each name has a delete button, which forgets it', () => {
  assert.match(SCRIPT, /op: 'forget', name/);
});

test("a page's link holds its number in the fragment, never the path", () => {
  assert.match(SCRIPT, /'\/page#page=' \+ page/);
  assert.doesNotMatch(SCRIPT, /'\/s\/' \+ page/);
});
