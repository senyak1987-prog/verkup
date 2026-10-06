import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';
import opentype from 'opentype.js';
import * as THREE from 'three';
const require = createRequire(import.meta.url);
function load(name, dependencies = {}) {
  const source = fs.readFileSync(new URL('../src/lib/' + name + '.ts', import.meta.url), 'utf8')
    .replaceAll('import.meta.env.BASE_URL', '"/"');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, key => dependencies[key] ?? require(key));
  return exports;
}
const contours = load('letterContours', { './glyphPath': load('glyphPath'), './systemFontContours': load('systemFontContours') });
const { filledGlyphShapes } = load('glyphShapes', { three: THREE });

// The serializer only emits these absolute SVG commands. Retain curves and
// closure just as SVGLoader does, without requiring a browser DOM for tests.
export function shapePathFromData(data) {
  const path = new THREE.ShapePath();
  for (const [, command, numbers] of data.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    const values = numbers.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (command === 'M') path.moveTo(...values);
    if (command === 'L') path.lineTo(...values);
    if (command === 'Q') path.quadraticCurveTo(...values);
    if (command === 'C') path.bezierCurveTo(...values);
    if (command === 'Z') path.currentPath.closePath();
  }
  return path;
}
function scanIntervals(polygons, y, nonzero) {
  const crossings = [];
  for (const polygon of polygons) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if ((a.y > y) === (b.y > y)) continue;
    crossings.push({ x: a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y), delta: b.y > a.y ? 1 : -1 });
  }
  crossings.sort((a, b) => a.x - b.x);
  const intervals = [];
  let winding = 0, previous;
  for (const point of crossings) {
    if (nonzero && winding !== 0 && previous !== undefined && point.x > previous) intervals.push([previous, point.x]);
    winding += point.delta;
    previous = point.x;
  }
  return intervals;
}
function triangleIntervals(triangles, y) {
  const intervals = [];
  for (const triangle of triangles) {
    const crossings = scanIntervals([triangle], y, true);
    intervals.push(...crossings);
  }
  return intervals;
}
function differenceLength(a, b) {
  const events = [...a.flatMap(([x, z]) => [[x, 1, 0], [z, -1, 0]]),
    ...b.flatMap(([x, z]) => [[x, 0, 1], [z, 0, -1]])].sort((p, q) => p[0] - q[0]);
  let activeA = 0, activeB = 0, previous = events[0]?.[0] ?? 0, difference = 0;
  for (const [x, da, db] of events) {
    if ((activeA > 0) !== (activeB > 0)) difference += x - previous;
    activeA += da; activeB += db; previous = x;
  }
  return difference;
}
export function surfaceDifference(path, shapes) {
  const polygons = path.subPaths.map(p => p.getPoints(24));
  const box = new THREE.Box2().setFromPoints(polygons.flat());
  const geometry = new THREE.ShapeGeometry(shapes, 24);
  const positions = geometry.getAttribute('position'), indices = geometry.getIndex();
  const triangles = [];
  for (let i = 0; i < indices.count; i += 3) triangles.push([0, 1, 2].map(offset => {
    const index = indices.getX(i + offset);
    return { x: positions.getX(index), y: positions.getY(index) };
  }));
  let maximum = 0;
  for (let row = 0; row < 97; row++) {
    const y = box.min.y + (row + .371) / 97 * (box.max.y - box.min.y);
    maximum = Math.max(maximum, differenceLength(scanIntervals(polygons, y, true), triangleIntervals(triangles, y)));
  }
  geometry.dispose();
  return maximum / Math.max(1, box.max.x - box.min.x);
}

const fonts = contours.SIGN_FONTS.filter(font => font.file).map(entry => {
  const bytes = fs.readFileSync(new URL('../public/fonts/' + entry.file, import.meta.url));
  return { ...entry, font: opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
});
test('Playfair Display М reproduces the former spurious triangle and retains its open notch after repair', () => {
  const entry = fonts.find(font => font.file === 'PlayfairDisplay-Variable.ttf');
  const path = shapePathFromData(contours.contoursFromFont(entry.font, 'М', entry.weight).pathData);
  assert.ok(surfaceDifference(path, path.toShapes()) > .1, 'The fixture must reproduce the reported 3D defect');
  assert.ok(surfaceDifference(path, filledGlyphShapes([path])) < .00001);
});
for (const entry of fonts) test(entry.label + ': all letter faces match the SVG nonzero fill, including holes and overlapping strokes', () => {
  for (const text of ['ШАУРМА', 'ЦВЕТЫ', 'Город Свет',
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789']) {
    const path = shapePathFromData(contours.contoursFromFont(entry.font, text, entry.weight).pathData);
    const shapes = filledGlyphShapes([path]);
    assert.ok(shapes.length > 0);
    assert.ok(surfaceDifference(path, shapes) < .00001, entry.label + ' ' + text);
    const solid = new THREE.ExtrudeGeometry(shapes, { depth: 50, bevelEnabled: false, curveSegments: 14 });
    assert.ok(Array.from(solid.attributes.position.array).every(Number.isFinite));
    solid.dispose();
  }
});

// Optional real browser traces verify installed Arial faces without publishing
// copies of the system fonts or requiring them on Linux CI runners.
const fixtureFlag = process.argv.indexOf('--system-fixtures');
if (fixtureFlag >= 0) {
  const fixtures = JSON.parse(fs.readFileSync(process.argv[fixtureFlag + 1], 'utf8'));
  for (const entry of fixtures) test(entry.label + ': actual system-font outlines preserve their SVG fill in 3D', () => {
    for (const sample of entry.samples) {
      const path = shapePathFromData(sample.path);
      assert.ok(surfaceDifference(path, filledGlyphShapes([path])) < .00001, sample.text);
    }
  });
}
