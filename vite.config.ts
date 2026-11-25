import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { renderSw, type BuiltFile } from './src/pwa/build';

/** Writes dist/sw.js from scripts/sw-template.js, listing the files the build produced (see src/pwa/build.ts). */
function serviceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'sideline-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: BuiltFile[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push({ path: relative(outDir, full).split('\\').join('/'), size: statSync(full).size, hash: createHash('sha1').update(readFileSync(full)).digest('hex').slice(0, 12) });
        }
      };
      walk(outDir);
      const template = readFileSync(resolve(import.meta.dirname, 'scripts/sw-template.js'), 'utf8');
      writeFileSync(join(outDir, 'sw.js'), renderSw(template, files));
    },
  };
}

export default defineConfig({
  plugins: [serviceWorker()],
  // Relative asset paths, so the build works on GitHub Pages under /<repo-name>/.
  base: './',
  resolve: {
    alias: [
      // maia3-js imports the default ONNX Runtime build, which loads the WebGPU
      // variant. Use the plain WebAssembly build: smaller, works everywhere, and
      // a 5M-parameter model is fast enough on the CPU.
      { find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' },
    ],
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'), // the app
        tests: resolve(import.meta.dirname, 'tests.html'), // feasibility tests
      },
    },
  },
});
