import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist/public', { recursive: true });
await cp('webserver/public', 'dist/public', { recursive: true });
await mkdir('dist/public/katex', { recursive: true });
await cp('node_modules/katex/dist/katex.min.css', 'dist/public/katex/katex.min.css');
await cp('node_modules/katex/dist/fonts', 'dist/public/katex/fonts', { recursive: true });
await build({ entryPoints: ['webserver/client/app.ts'], bundle: true, minify: true,
  format: 'esm', target: 'es2022', outfile: 'dist/public/app.js', sourcemap: true });
