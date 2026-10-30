import { defineConfig, type Plugin } from 'vitest/config';
import { createApiHandler } from './server/api.mjs';

/** `npm run dev` and `npm run preview` get the same /api endpoints as the CLI, so links can be crawled. */
function spiderApi(): Plugin {
  return {
    name: 'spider-crawler-api',
    configureServer(server) {
      server.middlewares.use(createApiHandler());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApiHandler());
    },
  };
}

export default defineConfig({
  // Relative base so the build works on GitHub Pages under /<repo>/ and from any static host.
  base: './',
  plugins: [spiderApi()],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
