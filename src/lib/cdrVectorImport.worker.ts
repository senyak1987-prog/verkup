import { decodeCdrBytes } from "./cdrDecoderCore";

type WorkerHost = {
  onmessage: ((event: MessageEvent<{ bytes: ArrayBuffer; decoderUrl: string }>) => void) | null;
  postMessage: (message: { svg?: string; error?: string }) => void;
};
const host = globalThis as unknown as WorkerHost;
host.onmessage = async event => {
  try {
    const response = await fetch(event.data.decoderUrl);
    if (!response.ok) throw new Error("Не удалось загрузить модуль CDR. Проверьте соединение и повторите импорт.");
    const svg = await decodeCdrBytes(new Uint8Array(event.data.bytes), new Uint8Array(await response.arrayBuffer()));
    host.postMessage({ svg });
  } catch (error) {
    host.postMessage({ error: error instanceof Error ? error.message : "Не удалось прочитать файл CDR." });
  }
};
