import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vitest/config';
import { createApiHandler } from './server/api.mjs';

const require = createRequire(import.meta.url);

/**
 * OCR runs on files served by the app itself, never a CDN: the Tesseract worker, its three
 * LSTM-only WebAssembly builds (it picks one for the device) and the English and French models.
 */
const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  'fra.traineddata.gz': '@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz',
};

function ocrAssets(): Plugin {
  const path = (file: string) => require.resolve(OCR_FILES[file]);
  return {
    name: 'spider-crawler-ocr',
    configureServer(server) {
      server.middlewares.use('/ocr', (req, res, next) => {
        const file = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (!OCR_FILES[file]) return next();
        // .gz files are sent as they are: Tesseract unzips them itself.
        res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(path(file)));
      });
    },
    generateBundle() {
      for (const file of Object.keys(OCR_FILES)) this.emitFile({ type: 'asset', fileName: `ocr/${file}`, source: readFileSync(path(file)) });
    },
  };
}

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
  plugins: [spiderApi(), ocrAssets()],
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
