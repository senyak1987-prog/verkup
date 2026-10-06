import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, KeyboardEvent } from 'react';
type Box = { x: number; y: number; width: number; height: number };
type Layout = { viewWidth: number; viewHeight: number; logoBox: Box; textX: number; textTop: number; textWidth: number; textHeight: number; signBox: Box };
export type LayoutPatch = Partial<{ logoOffsetX: number; logoOffsetY: number; textOffsetX: number; textOffsetY: number; logoScale: number; letterWidth: number; letterHeight: number }>;
export function SignLayoutEditor({ layout, project, onChange }: { layout: Layout;
  project: { logoEnabled: boolean; logoOffsetX: number; logoOffsetY: number; textOffsetX: number; textOffsetY: number; logoScale: number; letterHeight: number };
  onChange: (patch: LayoutPatch) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [handleSize, setHandleSize] = useState(24);
  useEffect(() => {
    const svg=svgRef.current; if(!svg) return;
    const update=()=> {const matrix=svg.getScreenCTM(); if(matrix) setHandleSize((svg.clientWidth < 500 ? 24 : 14) / Math.hypot(matrix.a,matrix.b));};
    update(); const observer=new ResizeObserver(update); observer.observe(svg); return ()=>observer.disconnect();
  }, [layout.viewWidth,layout.viewHeight]);
  const [selection, select] = useState<'text' | 'logo'>('text');
  const drag = useRef<{ point: DOMPoint; target: 'text' | 'logo'; resize: boolean; project: typeof project; layout: Layout } | null>(null);
  const pending = useRef<LayoutPatch | null>(null), frame = useRef(0);
  const flush = () => { if(frame.current) cancelAnimationFrame(frame.current); frame.current=0; if(pending.current) { onChange(pending.current); pending.current=null; } };
  const schedule = (patch: LayoutPatch) => { pending.current=patch; if(!frame.current) frame.current=requestAnimationFrame(flush); };
  useEffect(()=>()=>{if(frame.current) cancelAnimationFrame(frame.current);},[]);
  const position = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : new DOMPoint();
  };
  const start = (event: PointerEvent<SVGSVGElement>) => {
    const handle = (event.target as SVGElement).closest('[data-object]');
    if (!handle) return;
    event.preventDefault(); const target = handle.getAttribute('data-object') as 'text' | 'logo'; select(target);
    drag.current = { point: position(event), target, resize: handle.hasAttribute('data-resize'), project: { ...project }, layout };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current; if (!active) return;
    const point = position(event), dx = point.x - active.point.x, dy = point.y - active.point.y;
    if (active.resize) {
      if (active.target === 'logo') schedule({ logoScale: Math.max(45, Math.min(130, Math.round(active.project.logoScale + (Math.abs(dx)>Math.abs(dy)?dx:dy) / active.project.letterHeight * 100))) });
      else schedule({ letterWidth: Math.max(60, Math.round(active.layout.signBox.width + dx)), letterHeight: Math.max(40, Math.min(1200, Math.round(active.project.letterHeight * (1 + dy / active.layout.textHeight)))) });
    } else schedule(active.target === 'logo'
      ? { logoOffsetX: Math.round(active.project.logoOffsetX + dx), logoOffsetY: Math.round(active.project.logoOffsetY + dy) }
      : { textOffsetX: Math.round(active.project.textOffsetX + dx), textOffsetY: Math.round(active.project.textOffsetY + dy) });
  };
  const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault(); const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    onChange(selection === 'logo' ? { logoOffsetX: project.logoOffsetX + dx, logoOffsetY: project.logoOffsetY + dy }
      : { textOffsetX: project.textOffsetX + dx, textOffsetY: project.textOffsetY + dy });
  };
  const boxes = [{ id: 'text' as const, box: { x: layout.textX, y: layout.textTop, width: layout.textWidth, height: layout.textHeight } },
    ...(project.logoEnabled ? [{ id: 'logo' as const, box: layout.logoBox }] : [])];
  return <svg ref={svgRef} className="layout-editor-overlay" viewBox={`0 0 ${layout.viewWidth} ${layout.viewHeight}`} tabIndex={0} role="group"
    aria-label="Редактор макета. Выберите надпись или логотип, перетащите для перемещения. Угловой маркер меняет размер. Стрелки перемещают на 1 мм, Shift — на 10 мм."
    onPointerDown={start} onPointerMove={move} onPointerUp={() => { flush(); drag.current = null; }} onPointerCancel={() => { flush(); drag.current = null; }} onKeyDown={keyboard}>
    {boxes.map(({ id, box }) => <g key={id}>
      <rect data-object={id} {...box} className={selection === id ? 'editor-selection selected' : 'editor-selection'} vectorEffect="non-scaling-stroke" />
      <rect data-object={id} data-resize="true" x={box.x + box.width - handleSize/2} y={box.y + box.height - handleSize/2} width={handleSize} height={handleSize} className="editor-resize" vectorEffect="non-scaling-stroke" />
    </g>)}
  </svg>;
}
