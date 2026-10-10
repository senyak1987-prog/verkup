import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';

// Optional self-contained ES module for non-React sites. Run AFTER the main build.
await build({
  configFile: false,
  mode: 'rc-embed',
  build: {
    outDir: 'dist/rc-embed',
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('../src/rc-game/game.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'rc-game.js',
    },
  },
});
await copyFile('public/models/ram-trx.glb', 'dist/rc-embed/ram-trx.glb');
for (const lod of ['mobile', 'far']) await copyFile(`public/models/ram-trx-${lod}.glb`, `dist/rc-embed/ram-trx-${lod}.glb`);
await copyFile('public/models/ram-trx-attribution.txt', 'dist/rc-embed/ram-trx-attribution.txt');
