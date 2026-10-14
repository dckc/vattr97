/** The subset of `@endo/captp` used here; the package ships JSDoc only. */
declare module '@endo/captp' {
  export const makeCapTP: (
    ourId: string,
    send: (message: Record<string, unknown>) => void,
    bootstrapObj?: unknown,
  ) => {
    dispatch: (message: Record<string, unknown>) => boolean;
    getBootstrap: () => Promise<unknown>;
    abort: (reason?: unknown) => void;
  };
}
