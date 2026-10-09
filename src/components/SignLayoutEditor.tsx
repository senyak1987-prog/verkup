import { useEffect, useRef, useState } from "react";
import type { PointerEvent, KeyboardEvent } from "react";
import { layoutObjectBoxes, layoutReferenceBox, layoutSelectionBox, layoutSelectionObjects, marqueeBox, marqueeLayoutSelection, moveLayoutSelection, resizeLayoutLine } from "../lib/signLayoutAlignment";
import type { AlignmentBox, AlignmentLayout, LayoutObject, LayoutSelection } from "../lib/signLayoutAlignment";
import type { CanvasPointerSelection } from "../lib/canvasTextSelection";

type Layout = AlignmentLayout & { signBox: { x: number; y: number; width: number; height: number } };
type EditorProject = { logoEnabled: boolean; logoScale: number; logoSizeMm?:number; letterHeight: number; mountMode: string;
  letterLineOffsets?: { x: number; y: number }[]; letterLineHeights?: number[] };
export type LayoutPatch = Partial<{ logoOffsetX: number; logoOffsetY: number; textOffsetX: number; textOffsetY: number;
  logoScale: number; logoSizeMm:number; letterWidth: number; letterHeight: number; letterLineOffsets: { x: number; y: number }[];
  letterLineHeights: number[] }>;

type ResizeGroup = (selection: LayoutSelection, dx: number, dy: number) => LayoutPatch;

export function SignLayoutEditor({ layout, project, selection, zoom = 100, onSelect, onChange, onResizeGroup, onInteractionStart, onInteractionEnd, onUndo, onEditLine }:
  { layout: Layout; project: EditorProject; selection: LayoutSelection; onSelect: (object: LayoutSelection) => void;
    zoom?: number; onChange: (patch: LayoutPatch) => void; onResizeGroup?: ResizeGroup; onInteractionStart?: () => void; onInteractionEnd?: () => void; onUndo?: () => void; onEditLine?: (index: number, pointerSelection?: CanvasPointerSelection) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [handleSize, setHandleSize] = useState(24);
  const [framePadding, setFramePadding] = useState(12);
  const [surfaceBox, setSurfaceBox] = useState<AlignmentBox | null>(null);
  const [marquee, setMarquee] = useState<AlignmentBox | null>(null);
  const marqueeDrag = useRef<{ point: DOMPoint; inverse: DOMMatrix; pointerId: number; tolerance: number; previous: LayoutSelection; moved: boolean } | null>(null);
  const textDrag = useRef<{ pointerId: number; index: number; request: CanvasPointerSelection } | null>(null);
  const lastTextPress = useRef<{ index: number; x: number } | null>(null);
  const selectionId = useRef(0);
  const [snapped, setSnapped] = useState({ x: false, y: false });
  const drag = useRef<{ point: DOMPoint; inverse: DOMMatrix; pointerId: number; target: LayoutSelection; resize: boolean;
    project: EditorProject; layout: Layout; tolerance: number; moved: boolean; resizeGroup?: ResizeGroup } | null>(null);
  const pending = useRef<LayoutPatch | null>(null), frame = useRef(0);
  const onChangeRef = useRef(onChange);
  const onInteractionEndRef = useRef(onInteractionEnd);
  onChangeRef.current = onChange;
  onInteractionEndRef.current = onInteractionEnd;
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const update = () => { const matrix = svg.getScreenCTM(); if (matrix) {
      const scale = Math.hypot(matrix.a, matrix.b);
      setHandleSize((svg.clientWidth < 500 ? 24 : 14) / scale);
      setFramePadding((svg.clientWidth < 500 ? 18 : 14) / scale);
      // The empty-space hit area covers the viewport even when the artwork is zoomed out.
      const preview = svg.closest(".builder-preview");
      if (preview) {
        const bounds = preview.getBoundingClientRect(), inverse = matrix.inverse();
        setSurfaceBox(marqueeBox(new DOMPoint(bounds.left, bounds.top).matrixTransform(inverse),
          new DOMPoint(bounds.right, bounds.bottom).matrixTransform(inverse)));
      }
    } };
    update(); const observer = new ResizeObserver(update); observer.observe(svg);
    const transform = new MutationObserver(update), art = svg.closest(".preview-art");
    if (art) transform.observe(art, { attributes: true, attributeFilter: ["style"] });
    return () => { observer.disconnect(); transform.disconnect(); };
  }, [layout, zoom]);
  const flush = () => {
    if (frame.current) cancelAnimationFrame(frame.current); frame.current = 0;
    if (pending.current) { onChangeRef.current(pending.current); pending.current = null; }
  };
  const schedule = (patch: LayoutPatch) => { pending.current = patch; if (!frame.current) frame.current = requestAnimationFrame(flush); };
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); if (drag.current) onInteractionEndRef.current?.(); }, []);
  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (!event.isPrimary || event.button !== 0 || drag.current || textDrag.current || marqueeDrag.current) return;
    const handle = (event.target as SVGElement).closest("[data-object]");
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    if (!handle) {
      lastTextPress.current = null;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      const inverse = matrix.inverse();
      marqueeDrag.current = { point: new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse), inverse,
        pointerId: event.pointerId, tolerance: 3 / Math.hypot(matrix.a, matrix.b), previous: selection, moved: false };
      onSelect([]); event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    if (handle.hasAttribute("data-text-select")) {
      event.preventDefault();
      const index = Number(handle.getAttribute("data-object")!.slice(5));
      const request = { id: ++selectionId.current, anchorX: event.clientX, focusX: event.clientX, extend: event.shiftKey };
      textDrag.current = { pointerId: event.pointerId, index, request };
      lastTextPress.current = { index, x: event.clientX };
      event.currentTarget.setPointerCapture(event.pointerId);
      onEditLine?.(index, request); return;
    }
    lastTextPress.current = null;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    const object = handle.getAttribute("data-object") as LayoutObject;
    const resize = handle.hasAttribute("data-resize");
    const selected = layoutSelectionObjects(layout, selection, project.logoEnabled);
    const target = selected.length > 1 && (handle.hasAttribute("data-group-frame") || (!resize && selected.includes(object))) ? selected : object;
    onSelect(target); onInteractionStart?.();
    const inverse = matrix.inverse();
    drag.current = { point: new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse), inverse, pointerId: event.pointerId,
      target, resize, resizeGroup: onResizeGroup, project: { ...project }, layout, moved: false, tolerance: (event.pointerType === "touch" ? 8 : 6) / Math.hypot(matrix.a, matrix.b) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const area = marqueeDrag.current;
    if (area && area.pointerId === event.pointerId) {
      event.preventDefault();
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(area.inverse);
      if (!area.moved && Math.hypot(point.x - area.point.x, point.y - area.point.y) <= area.tolerance) return;
      area.moved = true;
      const box = marqueeBox(area.point, point);
      setMarquee(box); onSelect(marqueeLayoutSelection(layout, project.logoEnabled, box)); return;
    }
    const text = textDrag.current;
    if (text && text.pointerId === event.pointerId) {
      event.preventDefault(); onEditLine?.(text.index, { ...text.request, focusX: event.clientX }); return;
    }
    const active = drag.current; if (!active || active.pointerId !== event.pointerId) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(active.inverse);
    const dx = point.x - active.point.x, dy = point.y - active.point.y;
    if (!active.moved && Math.hypot(dx, dy) <= active.tolerance) return;
    active.moved = true;
    if (active.resize) {
      setSnapped({ x: false, y: false });
      if (typeof active.target !== "string") { const patch = active.resizeGroup?.(active.target, dx, dy); if (patch) schedule(patch); }
      else if (active.target === "logo") schedule({ logoSizeMm: Math.max(100, Math.min(700, Math.round((active.project.logoSizeMm??active.layout.logoBox.height) +
        (Math.abs(dx) > Math.abs(dy) ? dx : -dy)))) });
      else if (typeof active.target === "string" && active.target.startsWith("line-")) {
        const patch = resizeLayoutLine(active.layout, active.target, active.project.letterHeight, active.project.letterLineHeights, dx, -dy);
        if (patch) schedule(patch);
      }
      else schedule({ letterWidth: Math.max(60, Math.round(active.layout.signBox.width + dx)),
        letterHeight: Math.max(100, Math.min(700, Math.round(active.project.letterHeight * (1 - dy / active.layout.textHeight)))) });
    } else {
      const result = moveLayoutSelection(active.layout, active.target, active.project.logoEnabled, dx, dy,
        { constrainToPanel: active.project.mountMode === "acp", snapTolerance: event.altKey ? 0 : active.tolerance });
      setSnapped({ x: result.snappedX, y: result.snappedY }); schedule(result.patch);
    }
  };
  const finish = (event: PointerEvent<SVGSVGElement>) => {
    if (marqueeDrag.current?.pointerId === event.pointerId) {
      const area = marqueeDrag.current; marqueeDrag.current = null; setMarquee(null);
      if (event.type === "pointerup" && area.moved) {
        const box = marqueeBox(area.point, new DOMPoint(event.clientX, event.clientY).matrixTransform(area.inverse));
        const objects = marqueeLayoutSelection(layout, project.logoEnabled, box);
        onSelect(objects.length === 1 ? objects[0] : objects);
      } else if (event.type !== "pointerup") onSelect(area.previous);
      return;
    }
    if (textDrag.current?.pointerId === event.pointerId) {
      const text = textDrag.current; textDrag.current = null;
      if (event.type === "pointerup") onEditLine?.(text.index, { ...text.request, focusX: event.clientX });
      return;
    }
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    flush(); drag.current = null; setSnapped({ x: false, y: false }); onInteractionEnd?.();
  };
  const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "Escape") {
      event.preventDefault(); marqueeDrag.current = null; setMarquee(null);
      if (drag.current) { flush(); drag.current = null; setSnapped({ x: false, y: false }); onInteractionEnd?.(); }
      onSelect([]); return;
    }
    if ((event.key === "Enter" || event.key === "F2") && typeof selection === "string" && /^line-[012]$/.test(selection) && onEditLine) {
      event.preventDefault(); onEditLine(Number(selection.slice(5))); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); onUndo?.(); return; }
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault(); const step = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    onChange(moveLayoutSelection(layout, selection, project.logoEnabled, dx, dy, { constrainToPanel: project.mountMode === "acp" }).patch);
  };
  const boxes = layoutObjectBoxes(layout, project.logoEnabled);
  const objectFrames = boxes.map(({ id, box }) => ({ id, box, text: /^line-[012]$/.test(id),
    frameBox: { x: box.x - framePadding, y: box.y - framePadding, width: box.width + framePadding * 2, height: box.height + framePadding * 2 } }));
  const selected = layoutSelectionObjects(layout, selection, project.logoEnabled);
  const reference = layoutReferenceBox(layout, project.mountMode === "acp");
  const centerX = reference.x + reference.width / 2, centerY = reference.y + reference.height / 2;
  const selectedBox = layoutSelectionBox(layout, selection, project.logoEnabled);
  const groupBox = { x: selectedBox.x - framePadding * 2, y: selectedBox.y - framePadding * 2,
    width: selectedBox.width + framePadding * 4, height: selectedBox.height + framePadding * 4 };
  const alignedX = snapped.x || Math.abs(selectedBox.x + selectedBox.width / 2 - centerX) < .01;
  const alignedY = snapped.y || Math.abs(selectedBox.y + selectedBox.height / 2 - centerY) < .01;
  return <svg ref={svgRef} className="layout-editor-overlay" viewBox={`0 0 ${layout.viewWidth} ${layout.viewHeight}`} tabIndex={0} role="group" data-selected-objects={selected.join(" ")}
    aria-label="Редактор макета. Обведите объекты на свободном месте, чтобы выделить несколько. Перетащите рамку для перемещения выделенного. Протяните мышью по буквам, чтобы выделить текст. Маркер сверху справа меняет размер. Escape снимает выделение."
    onClick={event => { const text = lastTextPress.current; if (text && event.detail >= 2) onEditLine?.(text.index,
      { id: ++selectionId.current, anchorX: text.x, focusX: text.x, mode: event.detail >= 3 ? "line" : "word" }); }}
    onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={keyboard}>
    <rect {...(surfaceBox ?? { x: 0, y: 0, width: layout.viewWidth, height: layout.viewHeight })} fill="transparent" pointerEvents="all" />
    <g aria-hidden="true" pointerEvents="none" stroke="#65b787" vectorEffect="non-scaling-stroke">
      <line x1={centerX} y1={reference.y} x2={centerX} y2={reference.y + reference.height} strokeWidth={alignedX ? 2 : 1}
        strokeDasharray={alignedX ? undefined : "5 5"} opacity={alignedX ? .95 : .5} vectorEffect="non-scaling-stroke" />
      <line x1={reference.x} y1={centerY} x2={reference.x + reference.width} y2={centerY} strokeWidth={alignedY ? 2 : 1}
        strokeDasharray={alignedY ? undefined : "5 5"} opacity={alignedY ? .95 : .5} vectorEffect="non-scaling-stroke" />
      <circle cx={centerX} cy={centerY} r={handleSize * .22} fill="#124332" stroke="#b5ddc4" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </g>
    {selected.length > 1 && !marquee && <g>
      <rect {...groupBox} className="editor-selection selected editor-group-selection" pointerEvents="none" vectorEffect="non-scaling-stroke" />
      <rect data-object="composition" data-group-frame="true" {...groupBox} className="editor-move-frame" vectorEffect="non-scaling-stroke"><title>Переместить выделенные объекты: {selected.length}</title></rect>
    </g>}
    {objectFrames.map(({ id, frameBox }) => <g key={id}>
      <rect {...frameBox} pointerEvents="none" className={selected.includes(id) ? "editor-selection selected" : "editor-selection"} vectorEffect="non-scaling-stroke" />
      <rect data-object={id} data-move-frame="true" {...frameBox} className="editor-move-frame" vectorEffect="non-scaling-stroke"><title>Перетащите рамку, чтобы переместить выделенное</title></rect>
    </g>)}
    {/* Text hit areas stay above every expanded frame, including frames of neighbouring rows. */}
    {objectFrames.map(({ id, box, text }) => <rect key={id} data-object={id} data-text-select={text ? "true" : undefined} {...box} className={text ? "editor-text-hit" : "editor-object-hit"}><title>{text ? "Протяните мышью, чтобы выделить текст" : "Перетащите, чтобы переместить объект"}</title></rect>)}
    {objectFrames.filter(({ id }) => selected.length === 1 && selected[0] === id).map(({ id, frameBox }) => <rect key={id} data-object={id} data-resize="true" x={frameBox.x + frameBox.width - handleSize / 2} y={frameBox.y - handleSize / 2}
      width={handleSize} height={handleSize} className="editor-resize" vectorEffect="non-scaling-stroke" />)}
    {selected.length > 1 && !marquee && onResizeGroup && <rect data-object="composition" data-group-frame="true" data-resize="true"
      x={groupBox.x + groupBox.width - handleSize / 2} y={groupBox.y - handleSize / 2} width={handleSize} height={handleSize}
      className="editor-resize" vectorEffect="non-scaling-stroke" aria-label="Изменить размер группы пропорционально">
      <title>Потяните угол, чтобы изменить размер всей группы пропорционально</title>
    </rect>}
    {marquee && <rect {...marquee} className="editor-marquee" pointerEvents="none" vectorEffect="non-scaling-stroke" />}
  </svg>;
}
