import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { makeFakeKubo } from './test/fakeKubo.js';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Every outbound fetch from the Worker lands on an in-memory Kubo.
      miniflare: { outboundService: makeFakeKubo() },
    }),
  ],
});
