# diigo-cache

Your diigo bookmarks, cached in toybox vats, with a public page you can filter by week: `/public/<you>?in=2026-W41`. diigo has no API that takes a key any more, so the cache reads diigo's own web app API with your session, which the [session extension](../session-ext) hands it after you log in. This is a rebuild, on [toybox](../toybox), of capsite's diigo-cache, a Cloudflare Worker over a webapp factory.

## Run it

```sh
yarn install
(cd ../toybox && yarn build)
yarn serve
```

It prints `open: http://127.0.0.1:8788/#owner=...`: the owner page. Keep that link to yourself. It shows what's kept, refreshes, fills, and gives the proposal link for the extension.

- `DIIGO_CACHE_STATE`: where toybox keeps state (default `~/.local/state/diigo-cache`). A fresh state means new owner and proposal links.

Then hand it a session:

1. Load [the session extension](../session-ext/README.md) unpacked.
2. On the owner page, click "Proposal link for the extension": it copies the link (which holds a key, so the page never shows it) and shows a robot face drawn from the key. Paste it into the extension's Proposals page, check that the robot there matches, and Accept.
3. Log in to diigo, then click the toolbar button and "Send diigo". The cache refreshes diigo's newest pages (5 pages of 100), then fills 20 more pages of the rest. The popup reports counts, never bookmarks.
4. On the owner page, click "Fill to the end": it fills 20 pages at a time, with a pause between, until every page is stored, while the page stays open (a vat has no timer, so the page paces it). Stop stops it; Fill picks up where it left off.
5. Visit `/public/<your diigo username>?days=7`.

Send again after each login, or click Refresh or Fill on the owner page while the session lasts. Run it where your browser is: diigo seems to tie a session to the IP address it was issued to.

## Bookmarks you hold, a page anyone can read

- **Filter by date and search:** `?days=7`, `?in=2026-W41` (ISO week, UTC), `?after=2026-01-01&before=2026-02-01`, `?by=created`, and `?q=` with words, `"phrases"`, `#tags`, `-negation`, and gmail-style `newer_than:7d`. Add `format=json` for JSON. A vat has no clock, so `days` and `newer_than:` count back from the last refresh.
- **Private stays private:** shared and private bookmarks are kept in separate stores, and the public page is served from a viewer that holds the shared store alone.
- **Who holds what:** the cache vat reads diigo through one WebApp, narrowed to `load_user_items`, with the cookie in a header it sends but can't read. The gateway serves the pages, and has no network. The session keeper can write the cookie, and can't read diigo. [src/boot.js](src/boot.js) says who gets what.

## Not yet

From capsite's diigo-cache, not here yet: a fill that goes on with no page open, and a refresh every 3 hours (a vat has no clock or timer; capsite used a Durable Object's alarms), "invalidate the last N days", RSS export comparison, and the password-manager save button. Bookmarks deleted on diigo stay in the cache.

## Test

    yarn test

The tests run the vats in one process against a fake diigo ([test/diigo-cache.test.js](test/diigo-cache.test.js)); nothing reaches the network.
