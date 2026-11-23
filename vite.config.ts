import { defineConfig } from 'vite';

export default defineConfig({
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
});
