import { defineConfig } from 'vite';

export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:8765' } },
  // Static build previews keep the standalone sample experience.
  preview: { proxy: {} },
});
