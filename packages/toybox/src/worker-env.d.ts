/**
 * @file What workerd gives toybox's worker (config.capnp), as types: its
 * bindings, and the modules it embeds rather than imports.
 */

/** The supervisor's bindings (config.capnp). */
interface Env {
  KERNEL: DurableObjectNamespace<
    InstanceType<typeof import('./supervisor.js').Kernel>
  >;
  DIRECTORY: DurableObjectNamespace<import('./supervisor.js').Directory>;
  LOADER: WorkerLoader;
}

declare namespace Cloudflare {
  interface Exports {
    Syscall: LoopbackServiceStub<import('./kernel.js').Syscall>;
  }
}

/** the kernel vat runtime, bundled by build.js and embedded as text */
declare module 'vat-runtime.txt' {
  const src: string;
  export default src;
}
