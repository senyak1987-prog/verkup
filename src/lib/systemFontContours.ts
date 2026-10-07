import type { LetterContours } from './letterContours';
import { smoothContour } from './contourCurves';
type Point = [number, number];
function simplify(points: Point[], tolerance = 0.7): Point[] {
  if (points.length < 3) return points;
  const a = points[0], b = points[points.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  let greatest = tolerance * tolerance, split = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
    const distance = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
    if (distance > greatest) { greatest = distance; split = i; }
  }
  return split < 0 ? [a, b] : [...simplify(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplify(points.slice(split), tolerance)];
}
// Trace oriented pixel boundaries, including counters. The same paths feed SVG and WebGL.
export function traceAlpha(data: Uint8ClampedArray, width: number, height: number, tolerance=0.7, curves=false): string {
  const edges = new Map<string, Point[]>();
  const ink = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= 128;
  const add = (a: Point, b: Point) => { const key = a.join(','); const list = edges.get(key) ?? []; list.push(b); edges.set(key, list); };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (ink(x, y)) {
    if (!ink(x, y - 1)) add([x, y], [x + 1, y]);
    if (!ink(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (!ink(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
    if (!ink(x - 1, y)) add([x, y + 1], [x, y]);
  }
  const paths: string[] = [];
  while (edges.size) {
    const key = edges.keys().next().value!;
    const start = key.split(',').map(Number) as Point;
    const points: Point[] = [start]; let next = start;
    do {
      const currentKey = next.join(','), destinations = edges.get(currentKey);
      if (!destinations?.length) break;
      next = destinations.pop()!;
      if (!destinations.length) edges.delete(currentKey);
      points.push(next);
    } while (next[0] !== start[0] || next[1] !== start[1]);
    if (points.length > 3) {
      const reduced = simplify(points, tolerance);
      paths.push(curves ? smoothContour(reduced, tolerance) : 'M' + reduced.map(p => p.join(' ')).join('L') + 'Z');
    }
  }
  return paths.join('');
}
const availability = new Map<string, boolean>();
export function systemFontAvailable(family: string, weight: number) {
  const key=family+'|'+weight, cached=availability.get(key); if(cached!==undefined) return cached;
  const context=document.createElement('canvas').getContext('2d')!; const sample='ШЩMWij012';
  context.font=`${weight} 384px monospace`; const fallback=context.measureText(sample).width;
  context.font=`${weight} 384px "${family}",monospace`; const present=Math.abs(fallback-context.measureText(sample).width)>.1;
  availability.set(key,present); return present;
}
export function systemFontContours(family: string, text: string, weight: number): LetterContours {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // A long inscription must not allocate a huge bitmap; short inscriptions get
  // finer samples. Only outlines are retained in the cache, never this bitmap.
  ctx.font = `${weight} 1024px "${family}"`;
  const estimatedWidth = ctx.measureText(text || 'Н').width + 80;
  const size = Math.max(384, Math.min(1024, Math.floor(1024 * Math.sqrt(8_000_000 / (estimatedWidth * 1707))))), baseline = size * 1.25;
  const normalized = text.trim().normalize('NFC');
  const font = `${weight} ${size}px "${family}"`;
  // A missing system font must never silently masquerade as Arial Black.
  if (!systemFontAvailable(family,weight)) throw new Error(`${family} не установлен на этом устройстве. Выберите встроенный шрифт.`);
  ctx.font = font;
  const metric = ctx.measureText(normalized || 'Н');
  const reference = ctx.measureText(/[\p{Lu}\d]/u.test(normalized) ? 'Н' : 'н');
  canvas.width = Math.max(32, Math.ceil(metric.width + 40)); canvas.height = Math.ceil(size * 1.67);
  ctx.font = font; ctx.fillStyle = '#000'; ctx.fillText(normalized, 20, baseline);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x1 = canvas.width, y1 = canvas.height, x2 = 0, y2 = 0;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels.data[(y * canvas.width + x) * 4 + 3] >= 128) {
    x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x + 1); y2 = Math.max(y2, y + 1);
  }
  if (!normalized) { x1 = 0; x2 = 0; y1 = baseline; y2 = baseline; }
  return { pathData: traceAlpha(pixels.data, canvas.width, canvas.height, 1.2, true),
    inkBox: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
    mainBox: { x: x1, y: baseline - reference.actualBoundingBoxAscent, width: Math.max(1, x2 - x1),
      height: Math.max(1, reference.actualBoundingBoxAscent + reference.actualBoundingBoxDescent) } };
}
