import { defineConfig } from 'vite';

// `base: './'` keeps asset paths relative, so the build works on GitHub Pages
// under /<repo-name>/ without extra config.
export default defineConfig({
  base: './',
});
