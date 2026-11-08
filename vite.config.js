import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ChessLens runs fully locally. The Stockfish worker + wasm files are copied
// into public/engine by scripts/copy-engine.mjs so they are bundled at build
// time and never loaded from a CDN.
export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
  },
  preview: {
    host: 'localhost',
    port: 4173,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
