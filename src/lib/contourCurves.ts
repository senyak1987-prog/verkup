export type ContourPoint = [number, number];
type Point = ContourPoint;
const n = (v: number) => Number(v.toFixed(3));
const unit = ([x, y]: Point): Point => { const d = Math.hypot(x, y) || 1; return [x / d, y / d]; };
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const fmt = (p: Point) => `${n(p[0])} ${n(p[1])}`;

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const a = points[0], b = points[points.length - 1], delta = sub(b, a), squared = dot(delta, delta);
  let error = tolerance * tolerance, split = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const t = squared ? Math.max(0, Math.min(1, dot(sub(points[i], a), delta) / squared)) : 0;
    const difference: Point = [points[i][0] - a[0] - delta[0] * t, points[i][1] - a[1] - delta[1] * t];
    if (dot(difference, difference) > error) { error = dot(difference, difference); split = i; }
  }
  return split < 0 ? [a, b] : [...simplify(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplify(points.slice(split), tolerance)];
}

/** Least-squares cubic fitting within the tracing tolerance. Sharp joins remain sharp. */
function fit(points: Point[], start: Point, end: Point, tolerance: number): string {
  const a = points[0], b = points[points.length - 1], chord = sub(b, a), length = Math.hypot(...chord);
  const direction = unit(chord);
  if (points.length === 2 || points.every(p => Math.abs(direction[0] * (p[1] - a[1]) - direction[1] * (p[0] - a[0])) <= tolerance * .45))
    return `L${fmt(b)}`;
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(...sub(points[i], points[i - 1])));
  const parameters = distances.map(d => d / (distances[distances.length - 1] || 1));
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  parameters.forEach((t, i) => {
    const s = 1 - t, b0 = s ** 3, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t ** 3;
    const u: Point = [start[0] * b1, start[1] * b1], v: Point = [end[0] * b2, end[1] * b2];
    const residual: Point = [points[i][0] - a[0] * (b0 + b1) - b[0] * (b2 + b3), points[i][1] - a[1] * (b0 + b1) - b[1] * (b2 + b3)];
    c00 += dot(u, u); c01 += dot(u, v); c11 += dot(v, v); x0 += dot(u, residual); x1 += dot(v, residual);
  });
  const determinant = c00 * c11 - c01 * c01;
  let alpha = determinant ? (x0 * c11 - x1 * c01) / determinant : length / 3;
  let beta = determinant ? (c00 * x1 - c01 * x0) / determinant : length / 3;
  if (alpha < length * .001 || beta < length * .001 || alpha > length * 2 || beta > length * 2) alpha = beta = length / 3;
  const p: Point = [a[0] + start[0] * alpha, a[1] + start[1] * alpha], q: Point = [b[0] + end[0] * beta, b[1] + end[1] * beta];
  let error = 0, split = Math.floor(points.length / 2);
  parameters.forEach((t, i) => {
    if (!i || i === points.length - 1) return;
    const s = 1 - t;
    const curve: Point = [0, 1].map(axis => a[axis] * s ** 3 + p[axis] * 3 * s * s * t + q[axis] * 3 * s * t * t + b[axis] * t ** 3) as Point;
    const d = dot(sub(curve, points[i]), sub(curve, points[i]));
    if (d > error) { error = d; split = i; }
  });
  if (error <= tolerance * tolerance) return `C${fmt(p)} ${fmt(q)} ${fmt(b)}`;
  const tangent = unit(sub(points[split + 1], points[split - 1]));
  return fit(points.slice(0, split + 1), start, [-tangent[0], -tangent[1]], tolerance) + fit(points.slice(split), tangent, end, tolerance);
}

/** Fit a closed polygon; corners over 45 degrees are never rounded by a font correction. */
export function smoothContour(points: Point[], tolerance = 1): string {
  const closed = points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1] ? points : [...points, points[0]];
  const ring = simplify(closed, tolerance);
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  if (ring.length < 3) return '';
  const tangent = (i: number) => unit(sub(ring[(i + 1) % ring.length], ring[(i - 1 + ring.length) % ring.length]));
  const corners = ring.map((p, i) => dot(unit(sub(p, ring[(i - 1 + ring.length) % ring.length])), unit(sub(ring[(i + 1) % ring.length], p))) < Math.SQRT1_2 ? i : -1).filter(i => i >= 0);
  // Smooth rings need two anchored halves so a closed curve never has a zero chord.
  if (!corners.length) corners.push(0, Math.floor(ring.length / 2));
  else if (corners.length === 1) corners.push((corners[0] + Math.floor(ring.length / 2)) % ring.length);
  corners.sort((a, b) => a - b);
  return `M${fmt(ring[corners[0]])}` + corners.map((first, cursor) => {
    const last = corners[(cursor + 1) % corners.length];
    const segment = [ring[first]];
    for (let i = (first + 1) % ring.length; i !== last; i = (i + 1) % ring.length) segment.push(ring[i]);
    segment.push(ring[last]);
    const sharp = (i: number) => dot(unit(sub(ring[i], ring[(i - 1 + ring.length) % ring.length])), unit(sub(ring[(i + 1) % ring.length], ring[i]))) < Math.SQRT1_2;
    const start = sharp(first) ? unit(sub(segment[1], segment[0])) : tangent(first);
    const end = sharp(last) ? unit(sub(segment[segment.length - 2], segment[segment.length - 1])) : tangent(last).map(v => -v) as Point;
    return fit(segment, start, end, tolerance);
  }).join('') + 'Z';
}
