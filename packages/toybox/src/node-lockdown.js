// @endo/init/debug-async-hooks.js, but with `overrideTaming: 'moderate'`:
// Node 24's undici assigns `message` to its errors (ClientDestroyedError
// when a WebSocket closes), which 'min' makes a TypeError. The async_hooks
// patch keeps Node's async ids off promises, which would otherwise make an
// async method's result fail a guard's passable check.
const initDir = import.meta.resolve('@endo/init/package.json');
await import(new URL('src/node-async_hooks-patch.js', initDir).href);
await import('@endo/init/pre-remoting.js');

lockdown({
  errorTaming: 'unsafe',
  overrideTaming: 'moderate',
  domainTaming: 'unsafe',
});
