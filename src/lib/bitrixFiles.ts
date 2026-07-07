import type { BitrixDealFile } from "../types";

const IMAGE_FILE_RE = /\.(png|jpe?g|webp|gif|svg|bmp)$/i;

export function bitrixFileDisplayUrl(file?: BitrixDealFile) {
  if (!file) return "";
  return file.localUrl || file.url || file.downloadUrl || file.bitrixUrl || file.bitrixDownloadUrl || "";
}

export function bitrixFileDownloadUrl(file?: BitrixDealFile) {
  if (!file) return "";
  return file.localUrl || file.downloadUrl || file.url || file.bitrixDownloadUrl || file.bitrixUrl || "";
}

export function bitrixFileKey(file: BitrixDealFile, index = 0) {
  return [file.field, file.source, file.id, file.localUrl, file.url, index].filter(Boolean).join(":");
}

export function isBitrixImageFile(file?: BitrixDealFile) {
  if (!file) return false;
  const url = bitrixFileDisplayUrl(file);
  return (
    file.type === "image" ||
    String(file.mimeType || "").startsWith("image/") ||
    IMAGE_FILE_RE.test(file.name || "") ||
    IMAGE_FILE_RE.test(url.split("?")[0] || "")
  );
}

export function mergeBitrixFileLists(...lists: Array<BitrixDealFile[] | undefined>) {
  const seen = new Set<string>();
  const result: BitrixDealFile[] = [];

  for (const list of lists) {
    for (const file of list || []) {
      const key = [file.id, file.field, bitrixFileDisplayUrl(file), file.name].filter(Boolean).join(":");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(file);
    }
  }

  return result;
}
