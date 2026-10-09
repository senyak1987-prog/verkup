# Local CDR decoder

`cdr2svg.wasm` is an unmodified build from:
https://github.com/nobbs/go-libcdr/tree/57427ba5c758239f1debf10ca6034a7955227c73

Download: https://raw.githubusercontent.com/nobbs/go-libcdr/57427ba5c758239f1debf10ca6034a7955227c73/cdr2svg.wasm

Size: 1,048,119 bytes. SHA-256: `c0534886a6ad5112d6e096ce8319073db77cafb534c506fe7b7c37e8aefea9b8`.

The source, build scripts, native shim and converter entry point are available at that pinned source repository. The converter's complete original notice is distributed alongside the binary as `NOTICE.txt`; the MIT, MPL-2.0 and ICU licenses/notices are included here. Corresponding library source versions are linked in `NOTICE.txt`: libcdr 0.1.7, librevenge 0.0.6, lcms2 2.12 and zlib 1.3.1.

The application adds a 512 MiB maximum to the module's WebAssembly memory declaration in memory before compilation. That adaptation is published in `src/lib/cdrDecoderCore.ts`; the distributed upstream binary is unchanged. The browser WASI adapter is `@bjorn3/browser_wasi_shim` 0.4.2, MIT / Apache-2.0: https://github.com/bjorn3/browser_wasi_shim.

Conversion runs locally in a dedicated worker; the input is mounted read-only in an isolated in-memory filesystem. The app imposes a 10 MiB input, 16 MiB output and 15-second worker deadline. There is no file upload to a converter service.

Import scope: the converter's first page, followed by the app's normal SVG contour validation. Bitmap `<image>` objects, including CDR preview bitmaps, are explicitly discarded. Live text, gradients, effects and format-version compatibility are not guaranteed; for manufacturing outlines use filled, closed curves and export a simple SVG or vector PDF if the CDR is rejected.
