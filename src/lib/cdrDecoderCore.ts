import { WASI, File as WasiFile, OpenFile, ConsoleStdout, PreopenDirectory } from "@bjorn3/browser_wasi_shim";

export const CDR_MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_MEMORY_PAGES = 8192; // 512 MiB; also bounded by the worker's deadline.

/** Add a memory ceiling to the unmodified upstream CLI binary before compiling it. */
export function boundedCdrModule(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 97 || bytes[2] !== 115 || bytes[3] !== 109)
    throw new Error("Не удалось загрузить модуль чтения CDR.");
  let cursor = 8;
  const read = () => {
    let value = 0, shift = 0, byte = 0;
    do {
      if (cursor >= bytes.length || shift > 28) throw new Error("Повреждён модуль чтения CDR.");
      byte = bytes[cursor++]; value += (byte & 127) * 2 ** shift; shift += 7;
    } while (byte & 128);
    return value;
  };
  const encode = (value: number) => {
    const result: number[] = [];
    do { const byte = value & 127; value = Math.floor(value / 128); result.push(byte | (value ? 128 : 0)); } while (value);
    return result;
  };
  while (cursor < bytes.length) {
    const sectionStart = cursor, id = bytes[cursor++], length = read(), end = cursor + length;
    if (end > bytes.length) throw new Error("Повреждён модуль чтения CDR.");
    if (id === 5) {
      const count = read(), flags = read(), initial = read();
      const maximum = flags === 1 ? read() : MAX_MEMORY_PAGES;
      if (count !== 1 || flags > 1 || cursor !== end || initial > MAX_MEMORY_PAGES)
        throw new Error("Неподдерживаемый модуль чтения CDR.");
      const payload = [1, 1, ...encode(initial), ...encode(Math.min(maximum, MAX_MEMORY_PAGES))];
      const section = [5, ...encode(payload.length), ...payload];
      const result = new Uint8Array(sectionStart + section.length + bytes.length - end);
      result.set(bytes.subarray(0, sectionStart)); result.set(section, sectionStart);
      result.set(bytes.subarray(end), sectionStart + section.length);
      return result;
    }
    cursor = end;
  }
  throw new Error("В модуле чтения CDR отсутствует память.");
}

function supportedContainer(bytes: Uint8Array) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  return bytes.length >= 12 && (ascii(0, 2) === "PK" ||
    (ascii(0, 4) === "RIFF" && ascii(8, 11).toLowerCase() === "cdr") || ascii(0, 2) === "WL");
}

/** The same in-memory WASI code is exercised by Node regression tests and the browser worker. */
export async function decodeCdrBytes(document: Uint8Array, moduleBytes: Uint8Array): Promise<string> {
  if (!document.length) throw new Error("Файл CDR пуст.");
  if (document.length > CDR_MAX_INPUT_BYTES) throw new Error("Файл CDR должен быть не больше 10 МБ.");
  if (!supportedContainer(document)) throw new Error("Это не поддерживаемый файл CorelDRAW. Экспортируйте макет в SVG или векторный PDF.");
  const chunks: Uint8Array[] = [];
  let outputSize = 0;
  const stdout = new ConsoleStdout(bytes => {
    outputSize += bytes.byteLength;
    if (outputSize > MAX_OUTPUT_BYTES) throw new Error("Слишком сложный CDR. Оставьте только нужные контуры и экспортируйте их в SVG.");
    chunks.push(bytes.slice());
  });
  // Diagnostics are never rendered: user-controlled paths/text can occur in them.
  const stderr = new ConsoleStdout(() => {});
  const wasi = new WASI(["cdr2svg", "/input.cdr"], [], [
    new OpenFile(new WasiFile([], { readonly: true })), stdout, stderr,
    new PreopenDirectory("/", new Map([["input.cdr", new WasiFile(document, { readonly: true })]])),
  ], { debug: false });
  let module: WebAssembly.Module;
  try { module = await WebAssembly.compile(boundedCdrModule(moduleBytes).buffer as ArrayBuffer); }
  catch { throw new Error("Браузер не поддерживает модуль чтения CDR. Обновите браузер или загрузите SVG / векторный PDF."); }
  let exit: number;
  try {
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
    exit = wasi.start(instance as WebAssembly.Instance & { exports: { memory: WebAssembly.Memory; _start: () => unknown } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Слишком сложный CDR")) throw error;
    throw new Error("Не удалось прочитать CDR. Сохраните простой макет в кривых или экспортируйте его в SVG / векторный PDF.");
  }
  if (exit === 3) throw new Error("Эта версия CDR не поддерживается. Экспортируйте макет в SVG или векторный PDF.");
  if (exit !== 0 || !outputSize) throw new Error("CDR повреждён или содержит неподдерживаемые объекты. Экспортируйте макет в SVG или векторный PDF.");
  const output = new Uint8Array(outputSize);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(output);
}
