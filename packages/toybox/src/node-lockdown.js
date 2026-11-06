// @endo/init/debug.js, but with `overrideTaming: 'moderate'`: Node 24's
// undici assigns `message` to its errors (ClientDestroyedError when a
// WebSocket closes), which 'min' makes a TypeError.
import '@endo/init/pre-remoting.js';

lockdown({
  errorTaming: 'unsafe',
  overrideTaming: 'moderate',
  domainTaming: 'unsafe',
});
