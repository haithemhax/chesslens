import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Copies the single-threaded, lite Stockfish build into public/engine.
// Single-threaded builds do NOT need SharedArrayBuffer / COOP+COEP headers,
// which keeps `npm run preview` a plain static server. Lite is ~1.7 MB and
// far stronger than any human player, so it is ideal for a live show.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'node_modules', 'stockfish', 'bin');
const targetDir = join(root, 'public', 'engine');

const files = [
  'stockfish-19-lite-single.js',
  'stockfish-19-lite-single.wasm',
];

mkdirSync(targetDir, { recursive: true });

for (const file of files) {
  const source = join(sourceDir, file);
  const target = join(targetDir, file);
  if (!existsSync(source)) {
    console.error(`[engine:copy] Missing ${source}. Run "npm install" first.`);
    process.exit(1);
  }
  copyFileSync(source, target);
}

console.log('[engine:copy] Stockfish 19 lite single-threaded copied to public/engine');
