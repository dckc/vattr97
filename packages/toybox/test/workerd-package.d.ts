/** @file The workerd npm package, as test/workerd.js uses it: the path of its platform binary. */
declare module 'workerd' {
  const workerd: {
    default: string;
    version: string;
    compatibilityDate: string;
  };
  export default workerd;
}
