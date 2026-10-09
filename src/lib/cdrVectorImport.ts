const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const DECODE_TIMEOUT_MS = 15000;

/** CDR previews are bitmaps, never editable outlines. Parse without adding the SVG to the page. */
export function removeCdrBitmapPreviews(source: string): string {
  const xml = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = xml.documentElement;
  if (xml.querySelector("parsererror") || root.localName !== "svg") throw new Error("CDR не содержит корректной векторной страницы.");
  const images = [...xml.querySelectorAll("image")];
  for (const image of images) image.remove();
  root.setAttribute("data-cdr-image-count", String(images.length));
  if (!root.querySelector("path,rect,circle,ellipse,polygon,polyline"))
    throw new Error("В CDR не найдены векторные контуры. Растровая картинка предпросмотра не импортируется. Переведите объекты в кривые.");
  return new XMLSerializer().serializeToString(root);
}

/** Local CDR → SVG; SVG interpretation and contour validation belong to vectorFileImport. */
export async function cdrToSvg(file: File): Promise<string> {
  if (!file.size) throw new Error("Файл CDR пуст.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("Файл CDR должен быть не больше 10 МБ.");
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined")
    throw new Error("Браузер не поддерживает чтение CDR. Загрузите SVG или векторный PDF.");
  const bytes = await file.arrayBuffer();
  const svg = await new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL("./cdrVectorImport.worker.ts", import.meta.url), { type: "module" });
    const finish = (error?: Error, value?: string) => {
      clearTimeout(timer); worker.terminate();
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => finish(new Error("Чтение CDR заняло слишком долго. Оставьте нужные объекты и экспортируйте в SVG / векторный PDF.")), DECODE_TIMEOUT_MS);
    worker.onmessage = event => {
      const result = event.data as { svg?: string; error?: string };
      if (result.error || !result.svg) finish(new Error(result.error || "Не удалось прочитать файл CDR."));
      else finish(undefined, result.svg);
    };
    worker.onerror = () => finish(new Error("Не удалось запустить модуль CDR. Обновите браузер или используйте SVG / векторный PDF."));
    worker.postMessage({ bytes, decoderUrl: new URL(import.meta.env.BASE_URL + "vector-import/cdr2svg.wasm", window.location.origin).href }, [bytes]);
  });
  return removeCdrBitmapPreviews(svg);
}
