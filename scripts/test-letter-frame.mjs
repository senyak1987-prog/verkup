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

test('Trimless letters retain exact 40/50/60mm depth, flat original caps and a sub-mm side joint', async () => {
  const bytes = fs.readFileSync(new URL('../public/fonts/Manrope-Variable.ttf', import.meta.url));
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const data = contourApi.contoursFromFont(font, 'ОН', 800), natural = data.mainBox;
  const pathBox = { x: 120, y: 80, width: natural.width / natural.height * 120, height: 120 };
  const row = { id: 'line-0', index: 0, text: 'ОН', font: 'Manrope', box: pathBox, pathBox, inkBox: pathBox,
    pathData: data.pathData, naturalBox: natural, defaultX: pathBox.x, defaultY: pathBox.y };
  const glyphShapes = load('glyphShapes', { three: THREE });
  const baseline = new THREE.ExtrudeGeometry(glyphShapes.filledGlyphShapes(svgLoader.SVGLoader.prototype.parse('<path d="' + data.pathData + '" />').paths),
    { depth: 50, bevelEnabled: false, curveSegments: 14, steps: 1 });
  const expectedCapVertices = baseline.groups.filter(group => group.materialIndex === 0).reduce((sum, group) => sum + group.count, 0);
  for (const depth of [40, 50, 60]) {
    const project = { productId: 'letters', sceneMode: 'day', letterHeight: 120, letterDepth: depth, mountMode: 'frame', glowMode: 'face',
      logoEnabled: false, letterFaceColor: { value: '#ffffff' }, letterSideColor: { value: '#cccccc' }, outlineColor: { value: '#000000' } };
    const layout = { textRows: [row], frameSegments: frame([{ id: row.id, box: row.box }]).segments, signBox: pathBox,
      textX: pathBox.x, textTop: pathBox.y, textWidth: pathBox.width, textHeight: pathBox.height, logoBox: { x: 0, y: 0, width: 0, height: 0 } };
    const model = await scene.buildSignModel(project, layout, pathBox.width, pathBox.height, depth, false);
    const mesh = model.getObjectByName('extruded-letter-row-0'), geometry = mesh.geometry;
    const box = new THREE.Box3().setFromObject(mesh), positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), index = geometry.getIndex();
    assert.equal(box.min.z, 15); assert.equal(box.max.z, 15 + depth);
    assert.equal(mesh.material[0].metalness, 0); assert.ok(mesh.material[1].roughness > mesh.material[0].roughness);
    assert.equal(mesh.userData.frontSeamDepth, .55); assert.ok(geometry.groups.length <= 4, 'The seam must not add one draw call per contour edge');
    assert.equal(geometry.groups.filter(group => [0, 2].includes(group.materialIndex)).reduce((sum, group) => sum + group.count, 0), expectedCapVertices,
      'The seam only divides the side wall; it cannot add or duplicate face triangles');
    let curvedSideNormals = 0, frontJointVertices = 0;
    const shared = new Map();
    for (const group of geometry.groups) for (let offset = group.start; offset < group.start + group.count; offset++) {
      const vertex = index ? index.getX(offset) : offset, z = positions.getZ(vertex), normal = new THREE.Vector3().fromBufferAttribute(normals, vertex);
      assert.ok(Math.abs(normal.length() - 1) < .00001);
      if ([0, 2].includes(group.materialIndex)) {
        assert.ok(Math.abs(normal.x) < .000001 && Math.abs(normal.y) < .000001);
        assert.ok(Math.abs(z) < .001 || Math.abs(z - depth) < .001);
        assert.ok(Math.abs(normal.z - (z < depth / 2 ? -1 : 1)) < .000001);
      } else {
        assert.ok(Math.abs(normal.z) < .000001, 'Side smoothing cannot blend a cap normal into the return');
        if (Math.abs(normal.x) > .02 && Math.abs(normal.y) > .02) curvedSideNormals++;
        const key = [positions.getX(vertex), positions.getY(vertex), z].map(value => value.toFixed(4)).join(',');
        const adjacent = shared.get(key) ?? []; adjacent.push(normal); shared.set(key, adjacent);
        if (group.materialIndex === 3) { assert.ok(z >= depth - .5501 && z <= depth + .0001); frontJointVertices++; }
      }
    }
    assert.ok(curvedSideNormals > 0 && frontJointVertices > 0);
    let hardCorner = false;
    for (const adjacent of shared.values()) for (const a of adjacent) for (const b of adjacent) {
      if (a.dot(b) > Math.SQRT1_2) assert.ok(a.distanceTo(b) < .00001, 'Smooth neighbouring walls agree on a continuous highlight');
      else hardCorner = true;
    }
    assert.ok(hardCorner, 'The corners of Н remain sharp rather than being rounded into its face');
    scene.disposeSignObject(model);
  }
  baseline.dispose();
});

test('Frame tube edges are softly finished inside the square 15mm profile and welded joints reuse their own surface', async () => {
  const segments = frame([row('one', 0, 0, 700, 120), row('two', 150, 250, 400, 120)]).segments;
  const project = { productId: 'letters', sceneMode: 'day', letterHeight: 120, letterDepth: 50, mountMode: 'frame', glowMode: 'face',
    logoEnabled: false, letterFaceColor: { value: '#ffffff' }, letterSideColor: { value: '#cccccc' }, outlineColor: { value: '#000000' } };
  const model = await scene.buildSignModel(project, { frameSegments: segments, signBox: { x: 0, y: 0, width: 700, height: 370 },
    textPathData: 'M0 0', textNaturalBox: { x: 0, y: 0, width: 1, height: 1 }, textX: 0, textBaseline: 120, textHeight: 120,
    logoBox: { x: 0, y: 0, width: 0, height: 0 } }, 700, 370, 50, false);
  for (const segment of segments) {
    const pipe = model.children.find(child => child.userData.frameSegmentId === segment.id), geometry = pipe.geometry;
    geometry.computeBoundingBox(); const bounds = geometry.boundingBox;
    assert.equal(geometry.parameters.radius, .3);
    assert.ok(Math.abs(bounds.max.x - bounds.min.x - segment.width) < .001); assert.ok(Math.abs(bounds.max.y - bounds.min.y - segment.height) < .001);
    assert.equal(bounds.min.z, -7.5); assert.equal(bounds.max.z, 7.5);
    assert.ok(geometry.getAttribute('position').count <= 900, 'Tiny edge finishing stays within a practical tube budget');
    assert.equal(pipe.children.length, 0, 'Weld detailing must not overlay another coplanar mesh');
    const normals = geometry.getAttribute('normal'); let flat = 0, edge = 0;
    for (let index = 0; index < normals.count; index++) {
      const components = [normals.getX(index), normals.getY(index), normals.getZ(index)].map(Math.abs);
      if (components.some(value => value > .99999)) flat++; else edge++;
    }
    assert.ok(flat > 0 && edge > 0, 'The tube retains flat square faces with a slight edge highlight');
    if (segment.kind !== 'rail') { assert.ok(geometry.groups.length <= 2); assert.ok(geometry.groups.some(group => group.materialIndex === 1)); }
  }
  scene.disposeSignObject(model);
});

test('FrontSide acrylic caps face the camera, preserve material assignment and are hittable across every real glyph triangle', async () => {
  const entry = contourApi.SIGN_FONTS.find(item => item.file === 'Exo2-Variable.ttf');
  const bytes = fs.readFileSync(new URL('../public/fonts/' + entry.file, import.meta.url));
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const data = contourApi.contoursFromFont(font, 'ДАНА МИХОЙТ', entry.weight), natural = data.mainBox;
  const pathBox = { x: 100, y: 50, width: natural.width / natural.height * 2201, height: 2201 };
  const row = { id: 'line-0', index: 0, text: 'ДАНА МИХОЙТ', font: entry.value, box: pathBox, pathBox, inkBox: pathBox,
    pathData: data.pathData, naturalBox: natural, defaultX: pathBox.x, defaultY: pathBox.y };
  const model = await scene.buildSignModel({ productId: 'letters', sceneMode: 'day', letterHeight: 2201, letterDepth: 60, mountMode: 'frame', glowMode: 'face',
    logoEnabled: false, letterFaceColor: { value: '#ffffff' }, letterSideColor: { value: '#ffffff' }, outlineColor: { value: '#000000' } },
  { textRows: [row], frameSegments: [], signBox: pathBox, textX: pathBox.x, textTop: pathBox.y, textWidth: pathBox.width, textHeight: pathBox.height,
    logoBox: { x: 0, y: 0, width: 0, height: 0 } }, pathBox.width, pathBox.height, 60, false);
  model.updateMatrixWorld(true);
  const mesh = model.getObjectByName('extruded-letter-row-0'), geometry = mesh.geometry;
  const position = geometry.getAttribute('position'), indices = geometry.getIndex(), vertex = offset => indices ? indices.getX(offset) : offset;
  assert.equal(mesh.material[0].side, THREE.FrontSide); assert.equal(mesh.material[2].side, THREE.FrontSide);
  const coverage = new Set(); let frontTriangles = 0, hitTriangles = 0;
  for (const group of geometry.groups) for (let offset = group.start; offset < group.start + group.count; offset += 3) {
    assert.ok(offset + 2 < (indices?.count ?? position.count));
    for (const slot of [offset, offset + 1, offset + 2]) { assert.ok(!coverage.has(slot)); coverage.add(slot); }
    if (![0, 2].includes(group.materialIndex)) continue;
    const points = [0, 1, 2].map(i => new THREE.Vector3().fromBufferAttribute(position, vertex(offset + i)));
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    if (normal.lengthSq() < 1e-8) continue;
    normal.normalize();
    const expectedZ = group.materialIndex === 0 ? 60 : 0, expectedNormal = group.materialIndex === 0 ? 1 : -1;
    for (const point of points) assert.ok(Math.abs(point.z - expectedZ) < .0001, 'Material0 belongs only to the forward face, material2 only to the rear');
    assert.ok(Math.abs(normal.z - expectedNormal) < .000001, 'Actual triangle winding must face outward, independent of its shading normal');
    if (group.materialIndex === 0) {
      frontTriangles++;
      const center = points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
      const hit = new THREE.Raycaster(center.clone().add(new THREE.Vector3(0, 0, 10)), new THREE.Vector3(0, 0, -1)).intersectObject(mesh, false)[0];
      if (hit && hit.face.materialIndex === 0 && Math.abs(hit.point.z - 75) < .001) hitTriangles++;
    }
  }
  assert.equal(coverage.size, indices?.count ?? position.count); assert.ok(frontTriangles > 100);
  assert.equal(hitTriangles, frontTriangles, 'Every visible acrylic face triangle must survive FrontSide culling and ray projection');
  scene.disposeSignObject(model);
});

test('Actual captured Arial Black80 keeps every forward acrylic triangle visible through the production seam and smoothing', async () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/arial-black-raster-sign.json', import.meta.url), 'utf8'));
  const shapePath = svgLoader.SVGLoader.prototype.parse('<path d="' + fixture.pathData + '" />');
  const shapes = load('glyphShapes', { three: THREE }).filledGlyphShapes(shapePath.paths);
  const original = new THREE.ExtrudeGeometry(shapes, { depth: 60, bevelEnabled: false, steps: 2 });
  assert.equal(original.index, null, 'The installed r186 extrusion is nonindexed before the renderer restores reflected winding');
  const pathBox = { x: 140, y: 250, width: fixture.mainBox.width / fixture.mainBox.height * 80, height: 80 };
  const row = { id: 'line-1', index: 1, text: fixture.text, font: '"Arial Black", sans-serif', box: pathBox, pathBox, inkBox: pathBox,
    pathData: fixture.pathData, naturalBox: fixture.mainBox, defaultX: pathBox.x, defaultY: pathBox.y };
  const project = { productId: 'letters', sceneMode: 'day', letterHeight: 201, letterDepth: 60, mountMode: 'frame', glowMode: 'face',
    logoEnabled: false, letterFaceColor: { value: '#ffffff' }, letterSideColor: { value: '#ffffff' }, outlineColor: { value: '#000000' } };
  const model = await scene.buildSignModel(project, { textRows: [row], frameSegments: frame([{ id: row.id, box: row.box }]).segments, signBox: pathBox,
    textX: pathBox.x, textTop: pathBox.y, textWidth: pathBox.width, textHeight: 80, logoBox: { x: 0, y: 0, width: 0, height: 0 } }, pathBox.width, 80, 60, false);
  model.updateMatrixWorld(true);
  const mesh = model.getObjectByName('extruded-letter-row-1'), geometry = mesh.geometry;
  const position = geometry.getAttribute('position'), indices = geometry.getIndex(), triangles = new Set();
  const expected = original.groups.filter(group => group.materialIndex === 0).reduce((sum, group) => sum + group.count / 6, 0);
  let visible = 0;
  assert.equal(mesh.userData.font, row.font); assert.equal(mesh.material[0].side, THREE.FrontSide);
  for (const group of geometry.groups) if (group.materialIndex === 0) for (let offset = group.start; offset < group.start + group.count; offset += 3) {
    const points = [0, 1, 2].map(i => new THREE.Vector3().fromBufferAttribute(position, indices.getX(offset + i)));
    const key = points.map(point => point.toArray().join(',')).sort().join(';'); assert.ok(!triangles.has(key), 'The front joint cannot duplicate cap triangles'); triangles.add(key);
    const winding = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    assert.ok(winding.z > 0 && Math.abs(winding.x) < .000001 && Math.abs(winding.y) < .000001);
    for (const point of points) assert.equal(point.z, 60);
    const center = points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
    const hit = new THREE.Raycaster(center.clone().add(new THREE.Vector3(0, 0, 5)), new THREE.Vector3(0, 0, -1)).intersectObject(mesh, false)[0];
    assert.ok(hit && hit.face.materialIndex === 0 && Math.abs(hit.point.z - 75) < .001, 'Real raster font triangles survive culling at their forward face'); visible++;
  }
  assert.equal(visible, expected); assert.ok(visible > 100);
  for (const pipe of model.children.filter(child => child.name === 'frame-15x15mm')) {
    assert.equal(pipe.geometry.index, null, 'Rounded tube surfaces remain nonindexed and are not reinterpreted as vertex indices');
    assert.equal(pipe.geometry.getAttribute('position').count, 900);
  }
  original.dispose(); scene.disposeSignObject(model);
});

test('Actual Arial Black trim follows only its forward outer/counter contours and never runs along the 60mm return', async () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/arial-black-raster-sign.json', import.meta.url), 'utf8'));
  const pathBox = { x: 140, y: 250, width: fixture.mainBox.width / fixture.mainBox.height * 80, height: 80 };
  const row = { id: 'line-1', index: 1, text: fixture.text, font: '"Arial Black", sans-serif', box: pathBox, pathBox, inkBox: pathBox,
    pathData: fixture.pathData, naturalBox: fixture.mainBox, defaultX: pathBox.x, defaultY: pathBox.y };
  const project = { productId: 'letters', sceneMode: 'day', letterHeight: 201, letterDepth: 60, mountMode: 'frame', glowMode: 'face',
    letterOutlineEnabled: true, logoEnabled: false, letterFaceColor: { value: '#ffffff' }, letterSideColor: { value: '#ffffff' }, outlineColor: { value: '#ffffff' } };
  const layout = { textRows: [row], frameSegments: frame([{ id: row.id, box: row.box }]).segments, signBox: pathBox,
    textX: pathBox.x, textTop: pathBox.y, textWidth: pathBox.width, textHeight: 80, logoBox: { x: 0, y: 0, width: 0, height: 0 } };
  const model = await scene.buildSignModel(project, layout, pathBox.width, 80, 60, false);
  const mesh = model.getObjectByName('extruded-letter-row-1'), trim = mesh.getObjectByName('front-trim-contour');
  assert.ok(trim); assert.equal(trim.material.color.getHexString(), 'ffffff'); assert.equal(trim.material.depthWrite, false);
  const positions = trim.geometry.getAttribute('position'); let total = 0;
  for (let offset = 0; offset < positions.count; offset += 2) {
    assert.equal(positions.getZ(offset), 60); assert.equal(positions.getZ(offset + 1), 60);
    const a = new THREE.Vector3().fromBufferAttribute(positions, offset), b = new THREE.Vector3().fromBufferAttribute(positions, offset + 1);
    assert.ok(a.distanceTo(b) > .00001); total += a.distanceTo(b);
  }
  assert.ok(total > 100 && positions.count > 100);
  const previous = new THREE.EdgesGeometry(mesh.geometry, 35), old = previous.getAttribute('position');
  let oldLongitudinal = 0;
  for (let offset = 0; offset < old.count; offset += 2) if (Math.abs(old.getZ(offset) - old.getZ(offset + 1)) > 1) oldLongitudinal++;
  assert.ok(oldLongitudinal > 100, 'The real fixture reproduces the former cage of depth stripes');
  // Every trim edge must be a boundary (one cap triangle), including internal counters.
  const sourcePositions = mesh.geometry.getAttribute('position'), index = mesh.geometry.getIndex(), count = new Map();
  const key = point => point.map(value => value.toFixed(5)).join(':');
  const edgeKey = (a, b) => [key(a), key(b)].sort().join('/');
  for (const group of mesh.geometry.groups) if (group.materialIndex === 0) for (let offset = group.start; offset < group.start + group.count; offset += 3) {
    const triangle = [0, 1, 2].map(i => new THREE.Vector3().fromBufferAttribute(sourcePositions, index.getX(offset + i)).toArray());
    for (let i = 0; i < 3; i++) { const edge = edgeKey(triangle[i], triangle[(i + 1) % 3]); count.set(edge, (count.get(edge) ?? 0) + 1); }
  }
  for (let offset = 0; offset < positions.count; offset += 2) {
    const a = new THREE.Vector3().fromBufferAttribute(positions, offset).toArray(), b = new THREE.Vector3().fromBufferAttribute(positions, offset + 1).toArray();
    assert.equal(count.get(edgeKey(a, b)), 1, 'A trim line cannot reveal an internal triangulation edge');
  }
  const plain = await scene.buildSignModel({ ...project, letterOutlineEnabled: false }, layout, pathBox.width, 80, 60, false);
  assert.equal(plain.getObjectByName('front-trim-contour'), undefined, 'Switching trim off removes the whole graphic');
  previous.dispose(); scene.disposeSignObject(model); scene.disposeSignObject(plain);
});
