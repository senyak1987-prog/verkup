import { useEffect, useRef, useState } from "react";
import type { PointerEvent, KeyboardEvent } from "react";
import { layoutReferenceBox, layoutSelectionBox, moveLayoutSelection, resizeLayoutLine } from "../lib/signLayoutAlignment";
import type { AlignmentLayout, LayoutObject } from "../lib/signLayoutAlignment";

type Layout = AlignmentLayout & { signBox: { x: number; y: number; width: number; height: number } };
type EditorProject = { logoEnabled: boolean; logoScale: number; logoSizeMm?:number; letterHeight: number; mountMode: string;
  letterLineOffsets?: { x: number; y: number }[]; letterLineHeights?: number[] };
export type LayoutPatch = Partial<{ logoOffsetX: number; logoOffsetY: number; textOffsetX: number; textOffsetY: number;
  logoScale: number; logoSizeMm:number; letterWidth: number; letterHeight: number; letterLineOffsets: { x: number; y: number }[];
  letterLineHeights: number[] }>;

export function SignLayoutEditor({ layout, project, selection, onSelect, onChange, onInteractionStart, onInteractionEnd, onUndo }:
  { layout: Layout; project: EditorProject; selection: LayoutObject; onSelect: (object: LayoutObject) => void;
    onChange: (patch: LayoutPatch) => void; onInteractionStart?: () => void; onInteractionEnd?: () => void; onUndo?: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [handleSize, setHandleSize] = useState(24);
  const [snapped, setSnapped] = useState({ x: false, y: false });
  const drag = useRef<{ point: DOMPoint; inverse: DOMMatrix; pointerId: number; target: LayoutObject; resize: boolean;
    project: EditorProject; layout: Layout; tolerance: number } | null>(null);
  const pending = useRef<LayoutPatch | null>(null), frame = useRef(0);
  const onChangeRef = useRef(onChange);
  const onInteractionEndRef = useRef(onInteractionEnd);
  onChangeRef.current = onChange;
  onInteractionEndRef.current = onInteractionEnd;
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const update = () => { const matrix = svg.getScreenCTM(); if (matrix) setHandleSize((svg.clientWidth < 500 ? 24 : 14) / Math.hypot(matrix.a, matrix.b)); };
    update(); const observer = new ResizeObserver(update); observer.observe(svg); return () => observer.disconnect();
  }, [layout.viewWidth, layout.viewHeight]);
  const flush = () => {
    if (frame.current) cancelAnimationFrame(frame.current); frame.current = 0;
    if (pending.current) { onChangeRef.current(pending.current); pending.current = null; }
  };
  const schedule = (patch: LayoutPatch) => { pending.current = patch; if (!frame.current) frame.current = requestAnimationFrame(flush); };
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); if (drag.current) onInteractionEndRef.current?.(); }, []);
  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    const handle = (event.target as SVGElement).closest("[data-object]");
    const matrix = event.currentTarget.getScreenCTM();
    if (!handle || !matrix) return;
    event.preventDefault(); event.currentTarget.focus();
    const object = handle.getAttribute("data-object") as LayoutObject;
    const resize = handle.hasAttribute("data-resize");
    const target = !resize && selection === "composition" && !object.startsWith("line-") ? "composition" : object;
    onSelect(target); onInteractionStart?.();
    const inverse = matrix.inverse();
    drag.current = { point: new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse), inverse, pointerId: event.pointerId,
      target, resize, project: { ...project }, layout, tolerance: (event.pointerType === "touch" ? 8 : 6) / Math.hypot(matrix.a, matrix.b) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current; if (!active || active.pointerId !== event.pointerId) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(active.inverse);
    const dx = point.x - active.point.x, dy = point.y - active.point.y;
    if (active.resize) {
      setSnapped({ x: false, y: false });
      if (active.target === "logo") schedule({ logoSizeMm: Math.max(20, Math.min(900, Math.round((active.project.logoSizeMm??active.layout.logoBox.height) +
        (Math.abs(dx) > Math.abs(dy) ? dx : dy)))) });
      else if (active.target.startsWith("line-")) {
        const patch = resizeLayoutLine(active.layout, active.target, active.project.letterHeight, active.project.letterLineHeights, dx, dy);
        if (patch) schedule(patch);
      }
      else schedule({ letterWidth: Math.max(60, Math.round(active.layout.signBox.width + dx)),
        letterHeight: Math.max(40, Math.min(1200, Math.round(active.project.letterHeight * (1 + dy / active.layout.textHeight)))) });
    } else {
      const result = moveLayoutSelection(active.layout, active.target, active.project.logoEnabled, dx, dy,
        { constrainToPanel: active.project.mountMode === "acp", snapTolerance: event.altKey ? 0 : active.tolerance });
      setSnapped({ x: result.snappedX, y: result.snappedY }); schedule(result.patch);
    }
  };
  const finish = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    flush(); drag.current = null; setSnapped({ x: false, y: false }); onInteractionEnd?.();
  };
  const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); onUndo?.(); return; }
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault(); const step = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    onChange(moveLayoutSelection(layout, selection, project.logoEnabled, dx, dy, { constrainToPanel: project.mountMode === "acp" }).patch);
  };
  const textBox = layoutSelectionBox(layout, "text", project.logoEnabled);
  const textBoxes: { id: LayoutObject; box: typeof textBox }[] = layout.textRows?.length
    ? layout.textRows.map(row => ({ id: `line-${row.index}`, box: row.inkBox }))
    : [{ id: "text", box: textBox }];
  const boxes = [...textBoxes, ...(project.logoEnabled ? [{ id: "logo" as const, box: layout.logoBox }] : [])];
  const reference = layoutReferenceBox(layout, project.mountMode === "acp");
  const centerX = reference.x + reference.width / 2, centerY = reference.y + reference.height / 2;
  const selectedBox = layoutSelectionBox(layout, selection, project.logoEnabled);
  const alignedX = snapped.x || Math.abs(selectedBox.x + selectedBox.width / 2 - centerX) < .01;
  const alignedY = snapped.y || Math.abs(selectedBox.y + selectedBox.height / 2 - centerY) < .01;
  return <svg ref={svgRef} className="layout-editor-overlay" viewBox={`0 0 ${layout.viewWidth} ${layout.viewHeight}`} tabIndex={0} role="group"
    aria-label="Редактор макета. Нажмите на строку или выберите объект над макетом. Перетащите для перемещения, угловой маркер меняет размер. Стрелки — 1 мм, Shift — 10 мм. Alt отключает привязку к центру. Ctrl или Command Z отменяет изменение."
    onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={keyboard}>
    <g aria-hidden="true" pointerEvents="none" stroke="#65b787" vectorEffect="non-scaling-stroke">
      <line x1={centerX} y1={reference.y} x2={centerX} y2={reference.y + reference.height} strokeWidth={alignedX ? 2 : 1}
        strokeDasharray={alignedX ? undefined : "5 5"} opacity={alignedX ? .95 : .5} vectorEffect="non-scaling-stroke" />
      <line x1={reference.x} y1={centerY} x2={reference.x + reference.width} y2={centerY} strokeWidth={alignedY ? 2 : 1}
        strokeDasharray={alignedY ? undefined : "5 5"} opacity={alignedY ? .95 : .5} vectorEffect="non-scaling-stroke" />
      <circle cx={centerX} cy={centerY} r={handleSize * .22} fill="#124332" stroke="#b5ddc4" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </g>
    {selection === "composition" && <rect data-object="composition" {...selectedBox} className="editor-selection selected" vectorEffect="non-scaling-stroke" />}
    {boxes.map(({ id, box }) => <g key={id}>
      <rect data-object={id} {...box} className={selection === id ? "editor-selection selected" : "editor-selection"} vectorEffect="non-scaling-stroke" />
      {selection === id && <rect data-object={id} data-resize="true" x={box.x + box.width - handleSize / 2} y={box.y + box.height - handleSize / 2}
        width={handleSize} height={handleSize} className="editor-resize" vectorEffect="non-scaling-stroke" />}
    </g>)}
  </svg>;
}
