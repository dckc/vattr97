#!/usr/bin/env node
/**
 * @file Bundle toybox for workerd.
 *
 * Usage: ./build.js (from any directory)
 *
 * Writes dist/supervisor.js and dist/kvat-runtime.js, which config.capnp
 * embeds.
 */
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const external = ['cloudflare:workers', 'node:*'];

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'import'],
  external,
  logLevel: 'warning',
  // this package's directory, wherever the script is run from
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
};

/**
 * Write dist/: the supervisor, and the kernel vat runtime, which the kernel
 * loads as text beside each vat's own module (vat.js).
 *
 * @param {{ build: typeof esbuild.build }} [io] what writes the bundles; esbuild's, by default
 */
export const main = async ({ build } = { build: esbuild.build }) => {
  await build({
    ...common,
    entryPoints: ['supervisor.js'],
    outfile: 'dist/supervisor.js',
    external: [...external, 'kvat-runtime.txt'],
  });
  await build({
    ...common,
    entryPoints: ['kvat-runtime.js'],
    outfile: 'dist/kvat-runtime.js',
    external: [...external, './vat.js'],
  });
};

await main();
