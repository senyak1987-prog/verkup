import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(name, dependencies = {}) {
  const source = fs.readFileSync(new URL('../src/lib/' + name + '.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, key => {
    assert.ok(key in dependencies, 'Unexpected contour dependency: ' + key);
    return dependencies[key];
  });
  return exports;
}
const { traceAlpha } = load('systemFontContours', { './contourCurves': load('contourCurves') });

// Build a mask independently of canvas and of the contour fitter. The union
// of expanded rectangles reproduces a flat plate around a block letter Ш.
function raster(width, height, ink) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    if (ink(x + .5, y + .5)) data[(y * width + x) * 4 + 3] = 255;
  return { data, width, height };
}
function rectangleDistance(x, y, [left, top, width, height]) {
  return Math.hypot(Math.max(left - x, 0, x - left - width), Math.max(top - y, 0, y - top - height));
}
function shaPlate(letterWidth, offset, scale = 1) {
  const left = 40, top = 40, letterHeight = 180, stem = letterWidth * .17;
  const rectangles = [
    [left, top, stem, letterHeight],
    [left + (letterWidth - stem) / 2, top, stem, letterHeight],
    [left + letterWidth - stem, top, stem, letterHeight],
    [left, top + letterHeight - 30, letterWidth, 30],
  ];
  return raster(Math.ceil((letterWidth + 80) * scale), 300 * scale, (x, y) =>
    rectangles.some(rectangle => rectangleDistance(x / scale, y / scale, rectangle) <= offset));
}

// Sample every output segment at subpixel intervals, including long straight
// spans. Checking only the reduced tracing vertices missed the visible bulge.
function samplePath(data) {
  const rings = [];
  let point, first, ring;
  const append = next => { ring.push(next); point = next; };
  const line = end => {
    const start = point, steps = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / .7));
    for (let i = 1; i <= steps; i++) append([start[0] + (end[0] - start[0]) * i / steps, start[1] + (end[1] - start[1]) * i / steps]);
  };
  for (const [, command, coordinates] of data.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    const values = coordinates.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    assert.ok(values.every(Number.isFinite), 'A plate outline must contain finite coordinates');
    if (command === 'M') { point = first = values; ring = [point]; rings.push(ring); }
    else if (command === 'L') line(values);
    else if (command === 'Z') line(first);
    else {
      const start = point, controls = command === 'C'
        ? [values.slice(0, 2), values.slice(2, 4), values.slice(4, 6)]
        : [values.slice(0, 2), values.slice(2, 4)];
      const polygon = [start, ...controls];
      const length = polygon.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - polygon[i][0], p[1] - polygon[i][1]), 0);
      const steps = Math.max(2, Math.ceil(length / .7));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, s = 1 - t;
        const next = command === 'C'
          ? [0, 1].map(axis => start[axis] * s ** 3 + controls[0][axis] * 3 * s * s * t + controls[1][axis] * 3 * s * t * t + controls[2][axis] * t ** 3)
          : [0, 1].map(axis => start[axis] * s * s + controls[0][axis] * 2 * s * t + controls[1][axis] * t * t);
        append(next);
      }
    }
  }
  return rings;
}

// Index the actual oriented pixel boundary; this oracle does not use RDP or
// the source fitter, and covers curved output between all its anchor points.
function boundary(mask) {
  const edges = new Map();
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const ink = (x, y) => x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.data[(y * mask.width + x) * 4 + 3] >= 128;
  const add = (x1, y1, x2, y2) => {
    const key = Math.min(x1, x2) + ',' + Math.min(y1, y2);
    const bucket = edges.get(key) ?? []; bucket.push([x1, y1, x2, y2]); edges.set(key, bucket);
    left = Math.min(left, x1, x2); right = Math.max(right, x1, x2);
    top = Math.min(top, y1, y2); bottom = Math.max(bottom, y1, y2);
  };
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (ink(x, y)) {
    if (!ink(x, y - 1)) add(x, y, x + 1, y);
    if (!ink(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!ink(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!ink(x - 1, y)) add(x, y + 1, x, y);
  }
  return { edges, left, top, right, bottom };
}
function boundaryDistance(point, source, radius) {
  let squared = Infinity;
  const [x, y] = point, search = Math.ceil(radius) + 1, bx = Math.floor(x), by = Math.floor(y);
  for (let dy = -search; dy <= search; dy++) for (let dx = -search; dx <= search; dx++) {
    for (const [x1, y1, x2, y2] of source.edges.get((bx + dx) + ',' + (by + dy)) ?? []) {
      const vx = x2 - x1, vy = y2 - y1, t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / (vx * vx + vy * vy)));
      squared = Math.min(squared, (x - x1 - t * vx) ** 2 + (y - y1 - t * vy) ** 2);
    }
  }
  return Math.sqrt(squared);
}
function verifyContour(mask, tolerance, expectedRings = 1) {
  const path = traceAlpha(mask.data, mask.width, mask.height, tolerance, true);
  const rings = samplePath(path), source = boundary(mask);
  assert.equal(rings.length, expectedRings, 'Separate islands and counters must remain separate');
  // RDP and curve fitting each have a tolerance budget. The combined curve
  // must remain within their sum, without redrawing the physical plate.
  const allowed = tolerance * 2 + .05;
  for (const point of rings.flat()) {
    assert.ok(point[0] >= source.left - allowed && point[0] <= source.right + allowed && point[1] >= source.top - allowed && point[1] <= source.bottom + allowed,
      `Curve bulges outside its source bounds: ${point.join(', ')}; bottom=${source.bottom}`);
    const distance = boundaryDistance(point, source, allowed);
    assert.ok(distance <= allowed, `Plate curve deviates ${distance.toFixed(3)} px from the raster boundary (allowed ${allowed}) at ${point.join(', ')}`);
  }
  return { path, rings, source, allowed };
}

for (const offset of [15, 20, 25]) for (const scale of [1, 2]) test(`Ш plate: ${offset} mm outline at ${scale} px/mm has a flat bottom and bounded curves`, () => {
  const tolerance = Math.max(1.2, scale * .8);
  const { rings, source, allowed } = verifyContour(shaPlate(300, offset, scale), tolerance);
  const lowerEdge = rings[0].filter(([x, y]) => x > (40 + offset * 2) * scale && x < (340 - offset * 2) * scale && y > (220 + offset / 2) * scale);
  assert.ok(lowerEdge.length > 20, 'The entire long baseline must be sampled');
  assert.ok(lowerEdge.every(([, y]) => Math.abs(y - source.bottom) <= allowed), 'A straight bottom must not become a curved bulge');
});

for (const width of [180, 500, 1000]) test(`Ш plate: ${width} mm width keeps curved corners and long straight stems in proportion`, () => {
  verifyContour(shaPlate(width, 20), 1.2);
});

for (const scale of [.5, 1, 2]) test(`Fine plate tracing at ${scale} px/mm preserves the requested 20 mm offset`, () => {
  verifyContour(shaPlate(300, 20, scale), Math.max(.2, Math.min(.8, scale * .35)));
});

test('Rounded plate retains a hole and an independent island, with opposite counter winding', () => {
  const mask = raster(340, 260, (x, y) =>
    (Math.hypot(x - 115, y - 125) <= 85 && Math.hypot(x - 115, y - 125) >= 32) || rectangleDistance(x, y, [245, 70, 35, 110]) <= 15);
  const { rings } = verifyContour(mask, 1.2, 3);
  const areas = rings.map(ring => ring.reduce((sum, point, i) => {
    const next = ring[(i + 1) % ring.length]; return sum + point[0] * next[1] - next[0] * point[1];
  }, 0));
  assert.equal(areas.filter(area => area > 0).length, 2);
  assert.equal(areas.filter(area => area < 0).length, 1, 'A counter must not become a filled island');
});

test('Sharp rectangular plate corners remain exact straight joins', () => {
  const mask = raster(260, 160, (x, y) => x >= 20 && x < 240 && y >= 20 && y < 140);
  const { path } = verifyContour(mask, 1.2);
  assert.doesNotMatch(path, /[CQ]/, 'A sharp rectangular corner must not be rounded by tracing');
});
