import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { neonDesignPlacement } from '../lib/neonConstruction';
import type { NeonDesign, NeonLineBounds } from '../lib/neonConstruction';
import type { NeonSettings } from './NeonControls';

export type NeonEditorPatch = Partial<Pick<NeonSettings, 'neonLineOffsets' | 'neonLineScales'>>;
type Props = {
  design: NeonDesign;
  backerWidth: number;
  backerHeight: number;
  project: Pick<NeonSettings, 'neonLineOffsets' | 'neonLineScales'>;
  onChange: (patch: NeonEditorPatch) => void;
  selectedLine?: number;
  onSelectLine?: (index: number) => void;
};
type Drag = {
  pointerId: number;
  point: DOMPoint;
  inverseMatrix: DOMMatrix;
  line: NeonLineBounds;
  resize: boolean;
  scale: number;
  offsets: NeonSettings['neonLineOffsets'];
  scales: NeonSettings['neonLineScales'];
  bounds: { x: number; y: number; width: number; height: number };
  backerWidth: number;
  backerHeight: number;
  padding: number;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function NeonStudioEditor({ design, backerWidth, backerHeight, project, onChange, selectedLine, onSelectLine }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [localSelection, selectLocal] = useState(0), [handleSize, setHandleSize] = useState(20);
  const selection = selectedLine ?? localSelection;
  const lines = design.lines ?? [];
  const pad = Math.max(80, backerHeight * .2), viewWidth = backerWidth + pad * 2, viewHeight = backerHeight + pad * 2;
  const placement = neonDesignPlacement(design, backerWidth, backerHeight);
  const drag = useRef<Drag | null>(null), pending = useRef<NeonEditorPatch | null>(null), frame = useRef(0);
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const update = () => {
      const matrix = svg.getScreenCTM();
      if (matrix) setHandleSize((svg.clientWidth < 500 ? 24 : 14) / Math.max(.001, Math.hypot(matrix.a, matrix.b)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [viewWidth, viewHeight]);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);
  const flush = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (pending.current) { latestChange.current(pending.current); pending.current = null; }
  };
  const schedule = (patch: NeonEditorPatch) => {
    pending.current = patch;
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  };
  const selectLine = (index: number) => { selectLocal(index); onSelectLine?.(index); };
  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || drag.current) return;
    const handle = (event.target as SVGElement).closest('[data-neon-line]');
    const matrix = event.currentTarget.getScreenCTM();
    if (!handle || !matrix) return;
    const index = Number(handle.getAttribute('data-neon-line'));
    const line = lines.find(item => item.index === index);
    if (!line) return;
    event.preventDefault();
    const inverseMatrix = matrix.inverse();
    selectLine(index);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = {
      pointerId: event.pointerId,
      point: new DOMPoint(event.clientX, event.clientY).matrixTransform(inverseMatrix), inverseMatrix, line,
      resize: handle.hasAttribute('data-neon-resize'), scale: project.neonLineScales?.[index] ?? 1,
      offsets: Array.from({ length: 3 }, (_, row) => ({ ...(project.neonLineOffsets?.[row] ?? { x: 0, y: 0 }) })),
      scales: Array.from({ length: 3 }, (_, row) => project.neonLineScales?.[row] ?? 1),
      bounds: { ...line, x: line.x + placement.x + pad, y: line.y + placement.y + pad },
      backerWidth, backerHeight, padding: pad,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(active.inverseMatrix);
    const dx = point.x - active.point.x, dy = point.y - active.point.y, index = active.line.index;
    if (active.resize) {
      const { width, height } = active.bounds;
      const ratio = 1 + (dx * width + dy * height) / Math.max(1, width * width + height * height);
      const scales = [...active.scales];
      scales[index] = Math.round(clamp(active.scale * ratio, .5, 2) * 100) / 100;
      schedule({ neonLineScales: scales });
    } else {
      const { bounds, padding, backerWidth: width, backerHeight: height } = active;
      const margin = 12;
      const minX = padding + margin - bounds.x, maxX = padding + width - margin - bounds.x - bounds.width;
      const minY = padding + margin - bounds.y, maxY = padding + height - margin - bounds.y - bounds.height;
      const offsets = active.offsets.map(value => ({ ...value }));
      offsets[index] = {
        x: Math.round(clamp(active.offsets[index].x + (minX <= maxX ? clamp(dx, minX, maxX) : 0), -1800, 1800)),
        y: Math.round(clamp(active.offsets[index].y + (minY <= maxY ? clamp(dy, minY, maxY) : 0), -700, 700)),
      };
      schedule({ neonLineOffsets: offsets });
    }
  };
  const end = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    flush();
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const line = lines.find(item => item.index === selection);
    if (!line) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    const x = line.x + placement.x, y = line.y + placement.y;
    const offsets = Array.from({ length: 3 }, (_, index) => ({ ...(project.neonLineOffsets?.[index] ?? { x: 0, y: 0 }) }));
    offsets[selection].x = clamp(offsets[selection].x + Math.round(clamp(dx, Math.min(0, 12 - x), Math.max(0, backerWidth - 12 - x - line.width))), -1800, 1800);
    offsets[selection].y = clamp(offsets[selection].y + Math.round(clamp(dy, Math.min(0, 12 - y), Math.max(0, backerHeight - 12 - y - line.height))), -700, 700);
    onChange({ neonLineOffsets: offsets });
  };
  return <svg ref={svgRef} className="layout-editor-overlay neon-studio-editor" viewBox={`0 0 ${viewWidth} ${viewHeight}`} tabIndex={0} role="group"
    aria-label="Редактор неоновой вывески. Перетащите строку для перемещения. Угловой маркер меняет размер. Стрелки перемещают на 1 мм, Shift — на 10 мм."
    onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { flush(); drag.current = null; }} onKeyDown={keyboard}>
    {lines.map(line => {
      const x = line.x + placement.x + pad, y = line.y + placement.y + pad;
      return <g key={line.index}>
        <rect data-neon-line={line.index} x={x} y={y} width={line.width} height={line.height} className={selection === line.index ? 'editor-selection selected' : 'editor-selection'} vectorEffect="non-scaling-stroke" />
        {selection === line.index && <rect data-neon-line={line.index} data-neon-resize="true" x={x + line.width - handleSize / 2} y={y + line.height - handleSize / 2} width={handleSize} height={handleSize} className="editor-resize" vectorEffect="non-scaling-stroke" />}
      </g>;
    })}
  </svg>;
}
