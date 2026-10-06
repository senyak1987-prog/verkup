import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import opentype from 'opentype.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
function load(name, dependencies = {}) {
  const source = fs.readFileSync(new URL('../src/lib/' + name + '.ts', import.meta.url), 'utf8').replaceAll('import.meta.env.BASE_URL', '"/"');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const result = {}; new Function('exports', 'require', compiled)(result, id => dependencies[id] ?? require(id)); return result;
}

const source = fs.readFileSync(new URL('../src/lib/letterFrame.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
new Function('exports', compiled)(api);
const frame = api.letterFrameLayout;
const row = (id, x, y, width, height) => ({ id, box: { x, y, width, height } });
const railSegments = layout => layout.segments.filter(segment => segment.kind === 'rail');
const connectors = layout => layout.segments.filter(segment => segment.kind !== 'rail');
function connected(a, b) {
  return a.x <= b.x + b.width + .001 && b.x <= a.x + a.width + .001 &&
    a.y <= b.y + b.height + .001 && b.y <= a.y + a.height + .001;
}

test('Каждая строка имеет две трубы ровно по своей ширине с отступами 10–20 мм', () => {
  for (const inset of [10, 15, 20]) {
    const rows = [row('one', 120, 50, 1100, 220), row('two', 300, 330, 740, 140)];
    const layout = frame(rows, { topInset: inset, bottomInset: inset });
    assert.equal(railSegments(layout).length, 4);
    for (let i = 0; i < rows.length; i++) {
      const rails = railSegments(layout).filter(segment => segment.rowIds[0] === rows[i].id);
      const box = rows[i].box;
      assert.equal(rails[0].x, box.x); assert.equal(rails[0].width, box.width);
      assert.equal(rails[1].x, box.x); assert.equal(rails[1].width, box.width);
      assert.equal(rails[0].y - box.y, inset);
      assert.equal(box.y + box.height - rails[1].y - rails[1].height, inset);
      assert.equal(rails[0].height, 15); assert.equal(rails[1].height, 15);
    }
  }
});

test('Перемычки сваривают нижнюю трубу верхней строки с верхней трубой нижней', () => {
  const layout = frame([row('one', 100, 0, 1100, 200), row('two', 250, 290, 600, 160)]);
  const upper = railSegments(layout).find(segment => segment.id === 'row-one-bottom');
  const lower = railSegments(layout).find(segment => segment.id === 'row-two-top');
  const welds = connectors(layout);
  assert.equal(welds.length, 2);
  for (const weld of welds) {
    assert.equal(weld.width, 15); assert.ok(connected(weld, upper)); assert.ok(connected(weld, lower));
    assert.equal(weld.y, upper.y + upper.height); assert.equal(weld.y + weld.height, lower.y);
    assert.ok(weld.x >= lower.x && weld.x + weld.width <= lower.x + lower.width);
  }
});

test('Отдельно сдвинутые строки соединяются сварной перемычкой без удлинения своих труб', () => {
  const layout = frame([row('one', 0, 0, 320, 120), row('two', 450, 250, 440, 120)]);
  const welds = connectors(layout);
  assert.equal(welds.length, 3);
  assert.ok(connected(welds[0], welds[1])); assert.ok(connected(welds[1], welds[2]));
  assert.ok(connected(welds[0], railSegments(layout)[1])); assert.ok(connected(welds[2], railSegments(layout)[2]));
});

test('Круглый логотип присоединяется к двум внутренним трубам по своему контуру', () => {
  const logo = { box: { x: 0, y: 100, width: 280, height: 280 }, shape: 'circle' };
  const layout = frame([row('one', 320, 0, 900, 220), row('two', 320, 300, 1100, 200)], { logo });
  const links = layout.segments.filter(segment => segment.kind === 'logo-connector');
  assert.equal(links.length, 2);
  const inner = [layout.rowRails[0].bottom, layout.rowRails[1].top];
  for (const link of links) {
    const y = link.y + link.height / 2;
    assert.ok(inner.includes(y)); assert.equal(link.x + link.width, 320);
    const radius = 140;
    const edge = 140 + Math.sqrt(radius ** 2 - (y - 240) ** 2);
    assert.ok(Math.abs(link.x - edge + .5) < 1e-8);
  }
});

test('Логотип вне уровня внутренних труб получает сварной мост, связанный с рамой', () => {
  const layout = frame([row('one', 320, 0, 900, 220), row('two', 320, 300, 1100, 200)],
    { logo: { box: { x: 30, y: 600, width: 160, height: 160 }, shape: 'rounded' } });
  const bridge = layout.segments.find(segment => segment.id === 'logo-weld-bridge');
  const upright = layout.segments.find(segment => segment.id === 'logo-weld-upright');
  assert.ok(bridge); assert.ok(upright); assert.ok(connected(bridge, upright));
  assert.ok(railSegments(layout).some(rail => connected(rail, upright)));
});

test('В одной строке меньший логотип задаёт общие уровни труб', () => {
  const layout = frame([row('one', 300, 20, 1200, 300)],
    { logo: { box: { x: 20, y: 80, width: 180, height: 180 }, shape: 'circle' } });
  assert.equal(layout.rowRails[0].top, 102.5); assert.equal(layout.rowRails[0].bottom, 237.5);
  assert.equal(layout.segments.filter(segment => segment.kind === 'logo-connector').length, 2);
});

test('В одной строке меньшие буквы задают уровни, крупный логотип соединяется с ними', () => {
  const layout = frame([row('one', 400, 80, 1200, 180)],
    { logo: { box: { x: 20, y: 20, width: 300, height: 300 }, shape: 'square' } });
  assert.equal(layout.rowRails[0].top, 102.5); assert.equal(layout.rowRails[0].bottom, 237.5);
  assert.equal(layout.segments.filter(segment => segment.kind === 'logo-connector').length, 2);
});

test('Логотип над строкой получает вертикальную перемычку на своём контуре', () => {
  const logo = { box: { x: 380, y: -320, width: 180, height: 180 }, shape: 'circle' };
  const layout = frame([row('one', 200, 0, 1000, 210)], { logo });
  const bridge = layout.segments.find(segment => segment.id === 'logo-weld-vertical');
  assert.ok(bridge); assert.ok(connected(bridge, railSegments(layout)[0]));
  assert.ok(bridge.x + bridge.width / 2 >= logo.box.x && bridge.x + bridge.width / 2 <= logo.box.x + logo.box.width);
  assert.equal(bridge.y, -140.5); assert.equal(bridge.y + bridge.height, 15);
});

test('Совпадающие пары труб не удваиваются при наложении двух строк', () => {
  const layout = frame([row('one', 100, 20, 1000, 210), row('two', 100, 20, 1000, 210)]);
  assert.equal(railSegments(layout).length, 2);
  assert.equal(connectors(layout).length, 0);
  for (const rail of railSegments(layout)) assert.deepEqual(rail.rowIds, ['one', 'two']);
});

test('Невалидные объекты пропускаются, отступы ограничены, все сегменты конечны', () => {
  const layout = frame([row('bad', NaN, 0, 100, 100), row('good', -100, 40, 1200, 210)], { topInset: -2, bottomInset: 80 });
  assert.equal(layout.rowRails.length, 1); assert.equal(layout.rowRails[0].top, 57.5); assert.equal(layout.rowRails[0].bottom, 222.5);
  for (const segment of layout.segments) assert.ok([segment.x, segment.y, segment.width, segment.height].every(Number.isFinite));
  assert.equal(new Set(layout.segments.map(segment => segment.id)).size, layout.segments.length);
});

// Preserve actual quadratic/cubic font paths in the loader shim; no browser DOM
// is needed to verify the production extrusion, reflection and physical frames.
const svgLoader = { SVGLoader: class {
  parse(svg) {
    const data = / d="([^"]+)"/.exec(svg)?.[1] ?? '', path = new THREE.ShapePath();
    for (const [, command, numbers] of data.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
      const values = numbers.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (command === 'M') path.moveTo(...values);
      if (command === 'L') path.lineTo(...values);
      if (command === 'Q') path.quadraticCurveTo(...values);
      if (command === 'C') path.bezierCurveTo(...values);
      if (command === 'Z') path.currentPath.closePath();
    }
    return { paths: [path] };
  }
} };
const contourApi = load('letterContours', { './glyphPath': load('glyphPath'), './systemFontContours': load('systemFontContours') });
const scene = load('signSceneGeometry', { three: THREE, './letterContours': contourApi, './glyphShapes': load('glyphShapes', { three: THREE }),
  './neonScene': {}, './panelConstruction': load('panelConstruction'), 'three/examples/jsm/loaders/SVGLoader.js': svgLoader });
test('3D builds each independently fonted row and the exact shared welded-frame rectangles', async () => {
  const configurations = [
    { file: 'Manrope-Variable.ttf', weight: 800, text: 'ШАУРМА', x: 350, y: 0, width: 1000, height: 210 },
    { file: 'PlayfairDisplay-Variable.ttf', weight: 700, text: 'САМАЯ ВКУСНАЯ', x: 100, y: 290, width: 1500, height: 160 },
  ];
  const rows = configurations.map((configuration, index) => {
    const bytes = fs.readFileSync(new URL('../public/fonts/' + configuration.file, import.meta.url));
    const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const contours = contourApi.contoursFromFont(font, configuration.text, configuration.weight);
    const box = { x: configuration.x, y: configuration.y, width: configuration.width, height: configuration.height };
    return { id: 'line-' + index, index, text: configuration.text, font: configuration.file, box, pathBox: box, inkBox: box,
      pathData: contours.pathData, naturalBox: contours.mainBox, defaultX: box.x, defaultY: box.y };
  });
  const welded = frame(rows);
  const project = { productId: 'letters', sceneMode: 'day', letterHeight: 210, letterDepth: 50, mountMode: 'frame', glowMode: 'face',
    logoEnabled: false, letterFaceColor: { value: '#ffffff' }, letterSideColor: { value: '#222222' }, outlineColor: { value: '#000000' } };
  const layout = { textRows: rows, frameSegments: welded.segments, signBox: { x: 100, y: 0, width: 1500, height: 450 },
    textX: 100, textTop: 0, textWidth: 1500, textHeight: 450, logoBox: { x: 0, y: 0, width: 0, height: 0 } };
  const model = await scene.buildSignModel(project, layout, 1500, 450, 50, false);
  for (const row of rows) {
    const mesh = model.getObjectByName('extruded-letter-row-' + row.index);
    assert.ok(mesh); assert.equal(mesh.userData.font, row.font); assert.equal(mesh.userData.lineIndex, row.index);
    const world = new THREE.Box3().setFromObject(mesh);
    const near = (value, expected) => assert.ok(Math.abs(value - expected) < .015, `${value} vs ${expected}`);
    near(world.min.x, row.pathBox.x - 850); near(world.max.x, row.pathBox.x + row.pathBox.width - 850);
    // These capitals have the nominal H line; their descender is intentionally allowed below it.
    assert.ok(world.max.y >= 225 - row.pathBox.y - .02); assert.ok(world.min.y <= 225 - row.pathBox.y - row.pathBox.height + .02);
    near(world.min.z, 15); near(world.max.z, 65);
    assert.ok(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite));
  }
  const pipes = model.children.filter(child => child.name === 'frame-15x15mm');
  assert.equal(pipes.length, welded.segments.length);
  for (const segment of welded.segments) {
    const pipe = pipes.find(mesh => mesh.userData.frameSegmentId === segment.id), box = new THREE.Box3().setFromObject(pipe);
    assert.equal(pipe.userData.frameKind, segment.kind); assert.deepEqual(pipe.userData.frameRowIds, segment.rowIds);
    assert.ok(Math.abs(box.min.x - segment.x + 850) < .001); assert.ok(Math.abs(box.max.x - segment.x - segment.width + 850) < .001);
    assert.ok(Math.abs(box.max.y - 225 + segment.y) < .001); assert.ok(Math.abs(box.min.y - 225 + segment.y + segment.height) < .001);
    assert.equal(box.min.z, 0); assert.equal(box.max.z, 15);
  }
  scene.disposeSignObject(model);
});
