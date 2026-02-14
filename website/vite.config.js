import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        docs: resolve(__dirname, 'docs.html'),
        benchmarks: resolve(__dirname, 'benchmarks.html'),
        report: resolve(__dirname, 'report.html'),
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
