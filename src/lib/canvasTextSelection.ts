export type CanvasPointerSelection = {
  id: number; anchorX: number; focusX: number; extend?: boolean; mode?: "range" | "word" | "line";
};
export type CanvasSelection = { start: number; end: number; direction: "forward" | "backward" };

export function caretAtFraction(stops: readonly number[], fraction: number): number {
  return stops.reduce((best, stop, i) => Math.abs(stop - fraction) < Math.abs(stops[best] - fraction) ? i : best, 0);
}

export function canvasSelectionRange(text: string, anchor: number, focus: number, mode: CanvasPointerSelection["mode"] = "range"): CanvasSelection {
  const clamp = (n: number) => Math.max(0, Math.min(text.length, n));
  anchor = clamp(anchor); focus = clamp(focus);
  if (mode === "line") return { start: 0, end: text.length, direction: "forward" };
  if (mode === "word" && text.length) {
    const index = Math.min(focus, text.length - 1);
    const category = (char: string) => /[\p{L}\p{N}_]/u.test(char) ? "word" : /\s/u.test(char) ? "space" : "punctuation";
    const kind = category(text[index]);
    let start = index, end = index + 1;
    while (start > 0 && category(text[start - 1]) === kind) start--;
    while (end < text.length && category(text[end]) === kind) end++;
    return { start, end, direction: "forward" };
  }
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus), direction: focus < anchor ? "backward" : "forward" };
}
