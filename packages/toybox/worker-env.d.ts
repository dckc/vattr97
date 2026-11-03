/**
 * @file What workerd gives toybox's worker (config.capnp), as types: its
 * bindings, and the modules it embeds rather than imports.
 */

/** The supervisor's bindings (config.capnp). */
interface Env {
  KERNEL: DurableObjectNamespace<import('./kernel.js').Kernel>;
  DIRECTORY: DurableObjectNamespace<import('./supervisor.js').Directory>;
  LOADER: WorkerLoader;
  /** the fetch device's network: public addresses */
  INTERNET: Fetcher;
  /** the LAN device's network: private addresses, not loopback */
  LAN: Fetcher;
  /** the nix store, read-only */
  NIX_STORE: Fetcher;
  /** the git worktree, read-only */
  GIT_WORKTREE: Fetcher;
  /** the boot directory, read-only: the boot vat's code, and the bundles it makes vats from */
  BOOT: Fetcher;
}

declare namespace Cloudflare {
  interface Exports {
    Syscall: LoopbackServiceStub<import('./kernel.js').Syscall>;
  }
}

/** the kernel vat runtime, bundled by build.js and embedded as text */
declare module 'kvat-runtime.txt' {
  const src: string;
  export default src;
}

/** a text module: in a nixStore bundle, a `.txt` file's contents */
declare module '*.txt' {
  const text: string;
  export default text;
}
