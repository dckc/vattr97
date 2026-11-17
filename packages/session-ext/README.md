# session-ext

A browser extension that hands a site's session to a toybox app, so the app can read that site on your behalf without your password. A session is revocable, and it expires anyway. It follows [deleg8](https://github.com/dckc/deleg8), but works for many sites. The design and its open issues are in [vattr97#67](https://github.com/dckc/vattr97/issues/67).

## How it goes

1. **The app proposes a site.** Its page gives you a _proposal link_: the app's session endpoint, and a fragment naming the site, the cookies to read there, and the key to a door that can only write the session (toybox's [examples/session-keeper.js](../toybox/examples/session-keeper.js)).
2. **You accept it.** In the extension's Proposals page, paste the link and review what it reads and where it sends it. Accept asks the browser for access to those two hosts, and the browser's prompt names them. A site that sets its cookies for a parent of its host (domain=diigo.com, for www.diigo.com) proposes that domain too, since the browser hands an extension a cookie only with access to the cookie's domain; Accept then asks for the domain and its subdomains (`*.diigo.com`), and the review says so. Still, only the cookies the proposal names are read.
3. **You log in to the site, then click Send** in the toolbar popup. The extension reads the named cookies (HttpOnly ones too) and posts them to the app, which stores them where its WebApps send them from, and answers with a summary that leaves out the values.
4. **Dropping a proposal** tells the app to close its door, and gives up the hosts no other proposal needs.

The extension keeps only the accepted proposals, in `chrome.storage.local`, which is not encrypted. For keys to doors that can only write, that's acceptable. It never stores a session.

## Load it

In Chrome or Brave, open `chrome://extensions`, turn on developer mode, click "Load unpacked", and pick this directory. Loaded from a new path, it's a new extension, so you'll need to paste the proposals again.

## Code

[proposal.js](proposal.js) holds the logic and no authority: it doesn't touch `chrome.*`, `fetch`, or the clock. [popup.js](popup.js) and [options.js](options.js) hold those, and use each for one thing.

    npm test
