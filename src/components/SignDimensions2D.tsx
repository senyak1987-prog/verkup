import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

type DimensionLabel = { text: string; x: number; y: number; vertical: boolean; width: number; height: number };
const dimensionSelector = "[data-dimensions], [data-object-dimensions]";

/** Screen-space annotations blend against both the sign and the preview backdrop. */
export function SignDimensions2D({ sourceRef }: { sourceRef: RefObject<HTMLDivElement> }) {
  const host = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState({ lines: "", labels: [] as DimensionLabel[] });
  useLayoutEffect(() => {
    const source = sourceRef.current, overlay = host.current;
    if (!source || !overlay) return;
    const measure = document.createElement("canvas").getContext("2d");
    if (measure) measure.font = "600 14px Manrope, Arial, sans-serif";
    let frame = 0;
    const update = () => {
      frame = 0;
      const bounds = overlay.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const local = new DOMMatrix().scale(overlay.clientWidth / bounds.width, overlay.clientHeight / bounds.height)
        .translate(-bounds.x, -bounds.y);
      const labels: DimensionLabel[] = [], lines: string[] = [];
      const clamp = (value: number, edge: number, size: number) => Math.max(edge, Math.min(size - edge, value));
      source.querySelectorAll<SVGGElement>(dimensionSelector).forEach(group => {
        if (group.closest(".studio-svg-previous")) return;
        group.querySelectorAll<SVGTextElement>("text").forEach(text => {
          const rect = text.getBoundingClientRect(), value = text.textContent ?? "";
          const center = new DOMPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).matrixTransform(local);
          const vertical = Boolean(text.getAttribute("transform")?.includes("rotate"));
          const length = measure?.measureText(value).width ?? value.length * 8;
          const width = vertical ? 17 : length, height = vertical ? length : 17;
          const halfWidth = Math.min(overlay.clientWidth / 2, width / 2 + 8);
          const halfHeight = Math.min(overlay.clientHeight / 2, height / 2 + 4);
          const direction = group.hasAttribute("data-object-dimensions") ? -1 : 1;
          // Keep fixed-size text clear of its line even when the SVG is zoomed out.
          const gap = Math.max(0, (17 - (vertical ? rect.width : rect.height)) / 2) + 4;
          const label = { text: value, vertical, width, height,
            x: clamp(center.x + (vertical ? gap : 0), halfWidth, overlay.clientWidth),
            y: clamp(center.y + (vertical ? 0 : gap * direction), halfHeight, overlay.clientHeight) };
          for (let attempt = 0; attempt < 6 && labels.some(other =>
            Math.abs(other.x - label.x) < (other.width + width) / 2 + 6 &&
            Math.abs(other.y - label.y) < (other.height + height) / 2 + 4); attempt++) {
            label.y = clamp(label.y + direction * (height + 6), halfHeight, overlay.clientHeight);
          }
          labels.push(label);
        });
        group.querySelectorAll<SVGGraphicsElement>("path, line, polyline, polygon, rect, circle, ellipse").forEach(shape => {
          const matrix = shape.getScreenCTM();
          if (!matrix) return;
          const copy = shape.cloneNode(true) as SVGGraphicsElement;
          copy.removeAttribute("id"); copy.removeAttribute("style"); copy.removeAttribute("transform");
          copy.setAttribute("vector-effect", "non-scaling-stroke");
          const m = local.multiply(matrix);
          lines.push(`<g transform="matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})">${copy.outerHTML}</g>`);
        });
      });
      setDrawing({ lines: lines.join(""), labels });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    const resize = new ResizeObserver(schedule); resize.observe(source); resize.observe(overlay);
    // Includes zoom/translation, font contours, uploaded artwork and day/night replacement.
    const mutations = new MutationObserver(schedule);
    mutations.observe(source, { attributes: true, childList: true, characterData: true, subtree: true });
    return () => { resize.disconnect(); mutations.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [sourceRef]);
  return <div ref={host} className="studio-dimensions-2d" aria-hidden="true">
    <svg className="studio-measure-lines" width="100%" height="100%" dangerouslySetInnerHTML={{ __html: drawing.lines }} />
    {drawing.labels.map((label, index) => <span key={index} style={{ left: label.x, top: label.y,
      transform: `translate(-50%, -50%)${label.vertical ? " rotate(-90deg)" : ""}` }}>{label.text}</span>)}
  </div>;
}
