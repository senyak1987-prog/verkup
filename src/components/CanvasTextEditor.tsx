import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadLetterCaretFractions } from "../lib/letterContours";
import type { LetterRowLayout } from "../lib/letterRowsLayout";
import { caretAtFraction, canvasSelectionRange } from "../lib/canvasTextSelection";
import type { CanvasPointerSelection } from "../lib/canvasTextSelection";

type Props = {
  index: number; text: string; font: string; row?: LetterRowLayout;
  geometryKey: string; pointerSelection?: CanvasPointerSelection;
  onChange: (text: string) => void; onFinish: () => void; onCancel: () => void;
};

/** The native input owns typing/IME/selection; the actual SVG letters remain visible underneath. */
export function CanvasTextEditor({ index, text, font, row, geometryKey, pointerSelection, onChange, onFinish, onCancel }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [box, setBox] = useState({ left: 0, top: 0, width: 1, height: 24 });
  const [metrics, setMetrics] = useState<{ text: string; stops: number[] } | null>(null);
  const [selection, setSelection] = useState({ start: text.length, end: text.length });
  const appliedPointer = useRef<CanvasPointerSelection>();
  const gestureAnchor = useRef<{ id: number; index: number }>();
  const syncSelection = () => {
    const input = inputRef.current;
    if (input) setSelection({ start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 });
  };
  useLayoutEffect(() => {
    const input = inputRef.current;
    input?.focus({ preventScroll: true }); input?.setSelectionRange(text.length, text.length);
  }, []);
  useEffect(() => {
    let active = true;
    void loadLetterCaretFractions(font, text).then(stops => { if (active) setMetrics({ text, stops }); })
      .catch(() => { if (active) setMetrics({ text, stops: Array.from({ length: text.length + 1 }, (_, i) => i / Math.max(1, text.length)) }); });
    return () => { active = false; };
  }, [font, text]);
  useLayoutEffect(() => {
    const host = hostRef.current?.parentElement;
    const svg = host?.querySelector<SVGSVGElement>(".layout-editor-overlay");
    if (!host || !svg || !row) return;
    const update = () => {
      const matrix = svg.getScreenCTM(); if (!matrix) return;
      const bounds = host.getBoundingClientRect();
      const start = new DOMPoint(row.pathBox.x, row.inkBox.y).matrixTransform(matrix);
      const end = new DOMPoint(row.pathBox.x + row.pathBox.width, row.inkBox.y + row.inkBox.height).matrixTransform(matrix);
      setBox({ left: start.x - bounds.x, top: start.y - bounds.y, width: end.x - start.x, height: Math.max(12, end.y - start.y) });
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(host); observer.observe(svg);
    return () => observer.disconnect();
  }, [row, geometryKey]);
  useLayoutEffect(() => {
    if (!pointerSelection || appliedPointer.current === pointerSelection || !metrics || metrics.text !== text || !row) return;
    const bounds = hostRef.current?.getBoundingClientRect();
    const input = inputRef.current; if (!bounds || !input) return;
    const caret = (x: number) => caretAtFraction(metrics.stops, (x - bounds.left) / Math.max(1, bounds.width));
    if (gestureAnchor.current?.id !== pointerSelection.id) {
      gestureAnchor.current = { id: pointerSelection.id, index: pointerSelection.extend
        ? (input.selectionDirection === "backward" ? input.selectionEnd : input.selectionStart) ?? 0
        : caret(pointerSelection.anchorX) };
    }
    const next = canvasSelectionRange(text, gestureAnchor.current.index, caret(pointerSelection.focusX), pointerSelection.mode);
    appliedPointer.current = pointerSelection;
    input.focus({ preventScroll: true }); input.setSelectionRange(next.start, next.end, next.direction); syncSelection();
  }, [metrics, box, text, pointerSelection, row]);
  const stops = metrics?.text === text ? metrics.stops : Array.from({ length: text.length + 1 }, (_, i) => i / Math.max(1, text.length));
  const left = (stops[selection.start] ?? 0) * box.width;
  const right = (stops[selection.end] ?? 0) * box.width;
  return <div ref={hostRef} className="canvas-text-editor" style={box}>
    <input ref={inputRef} className="canvas-text-input" type="text" maxLength={60} value={text}
      aria-label={`Текст строки ${index + 1} на макете`} autoComplete="off" spellCheck={false}
      onSelect={syncSelection} onChange={event => { appliedPointer.current = pointerSelection; onChange(event.target.value); syncSelection(); }} onBlur={onFinish}
      onKeyDown={event => {
        event.stopPropagation();
        appliedPointer.current = pointerSelection;
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); onCancel(); }
        if (event.key === "Enter") { event.preventDefault(); onFinish(); }
      }} />
    {selection.start !== selection.end ? <span aria-hidden="true" className="canvas-text-selection" style={{ left: Math.min(left, right), width: Math.abs(right - left) }} />
      : <span aria-hidden="true" key={`${text}:${selection.start}`} className="canvas-text-caret" style={{ left }} />}
  </div>;
}
