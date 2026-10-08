import { build } from 'vite';
import { fileURLToPath } from 'node:url';

// Optional self-contained ES module for non-React sites. Run AFTER the main build.
await build({
  configFile: false,
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
