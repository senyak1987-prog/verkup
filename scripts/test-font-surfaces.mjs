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

const fonts = [...contours.SIGN_FONTS, ...contours.LEGACY_SIGN_FONTS].filter(font => font.file).map(entry => {
  const bytes = fs.readFileSync(new URL('../public/fonts/' + entry.file, import.meta.url));
  return { ...entry, font: opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
});
test('The picker offers distinct fonts and archived font names retain their exact outlines', () => {
  assert.equal(contours.SIGN_FONTS.length, 16);
  for (const entry of contours.LEGACY_SIGN_FONTS) {
    assert.ok(!contours.SIGN_FONTS.some(font => font.value === entry.value));
    assert.equal(contours.resolveSignFont(entry.value).file, entry.file);
    assert.equal(contours.resolveSignFont(entry.value).weight, entry.weight);
  }
  for (const entry of contours.SIGN_FONTS) assert.equal(contours.resolveSignFont(entry.value).value, entry.value);
});
test('Playfair Display М reproduces the former spurious triangle and retains its open notch after repair', () => {
  const entry = fonts.find(font => font.file === 'PlayfairDisplay-Variable.ttf');
  const path = shapePathFromData(contours.contoursFromFont(entry.font, 'М', entry.weight).pathData);
  assert.ok(surfaceDifference(path, path.toShapes()) > .1, 'The fixture must reproduce the reported 3D defect');
  assert.ok(surfaceDifference(path, filledGlyphShapes([path])) < .00001);
});
for (const entry of fonts) test(entry.label + ': all letter faces match the SVG nonzero fill, including holes and overlapping strokes', () => {
  const alphabet = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;!?«»()№+-/';
  for (const character of alphabet) {
    assert.ok(entry.font.hasChar(character), entry.label + ': missing ' + character);
    const glyph = contours.contoursFromFont(entry.font, character, entry.weight);
    assert.ok(glyph.pathData.length > 0, entry.label + ': blank ' + character);
    assert.ok(glyph.inkBox.width > 0 && glyph.inkBox.height > 0, entry.label + ': empty ' + character);
    assert.doesNotMatch(glyph.pathData, /NaN|Infinity|undefined/);
  }
  for (const text of ['ШАУРМА', 'ЦВЕТЫ', 'Город Свет',
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '.,:;!?«»()№+-/']) {
    const path = shapePathFromData(contours.contoursFromFont(entry.font, text, entry.weight).pathData);
    const shapes = filledGlyphShapes([path]);
    assert.ok(shapes.length > 0);
    assert.ok(surfaceDifference(path, shapes) < .00001, entry.label + ' ' + text);
    const solid = new THREE.ExtrudeGeometry(shapes, { depth: 50, bevelEnabled: false, curveSegments: 14 });
    assert.ok(Array.from(solid.attributes.position.array).every(Number.isFinite));
    solid.dispose();
  }
});

test('Actual browser-traced Arial Black at 80 mm keeps the SVG holes and flat, finite 3D faces', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/arial-black-raster-sign.json', import.meta.url), 'utf8'));
  const path = shapePathFromData(fixture.pathData), shapes = filledGlyphShapes([path]);
  assert.ok(shapes.some(shape => shape.holes.length > 0), 'Counters must survive the real raster trace');
  assert.ok(surfaceDifference(path, shapes) < .00001);
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: 60, bevelEnabled: false, curveSegments: 14, steps: 1 });
  const scale = fixture.heightMm / fixture.mainBox.height;
  geometry.scale(scale, -scale, 1);
  // Reproduce the sign renderer's Y reflection and restored winding.
  const count = geometry.attributes.position.count, reversed = new Array(count);
  for (let i = 0; i < count; i += 3) { reversed[i] = i; reversed[i+1] = i+2; reversed[i+2] = i+1; }
  geometry.setIndex(reversed); geometry.computeVertexNormals();
  const positions = geometry.attributes.position, normals = geometry.attributes.normal;
  assert.ok(Array.from(positions.array).every(Number.isFinite));
  assert.ok(Array.from(normals.array).every(Number.isFinite));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const group of geometry.groups) if (group.materialIndex === 0) {
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const vertices = [0,1,2].map(offset => geometry.index.getX(i+offset));
      a.fromBufferAttribute(positions,vertices[0]); b.fromBufferAttribute(positions,vertices[1]); c.fromBufferAttribute(positions,vertices[2]);
      assert.ok(b.sub(a).cross(c.sub(a)).lengthSq() > 1e-10, 'A cap triangle must have nonzero area');
      for (const index of vertices) {
        assert.ok(Math.abs(normals.getX(index)) < .00001 && Math.abs(normals.getY(index)) < .00001);
        assert.ok(Math.abs(Math.abs(normals.getZ(index))-1) < .00001, 'The entire letter face must share its flat normal');
      }
    }
  }
  geometry.dispose();
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
