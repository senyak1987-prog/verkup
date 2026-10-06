import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import opentype from "opentype.js";
import ts from "typescript";
import * as THREE from "three";

// Load the real serializer without Three.js, a browser DOM, or emitted test files.
const source = fs.readFileSync(new URL("../src/lib/glyphPath.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function("exports", compiled)(exports);
const { serializeGlyphPath } = exports;

test("Координата около целого числа сохраняет валидный контур", () => {
  const path = new opentype.Path();
  path.moveTo(115.00000000000001, 0);
  path.lineTo(118.875, -30.025);
  path.close();
  assert.equal(serializeGlyphPath(path), "M115 0L118.875 -30.025Z");
});

test("Реальные контуры ЦВЕТЫ в Manrope 800 не содержат NaN", () => {
  const bytes = fs.readFileSync(new URL("../public/fonts/Manrope-Variable.ttf", import.meta.url));
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const path = font.getPath("ЦВЕТЫ", 0, 0, 100, { kerning: true, variation: { wght: 800 } });
  assert.ok(path.commands.length > 100);
  assert.ok(path.commands.some(command => command.x === 115.00000000000001));
  const serialized = serializeGlyphPath(path);
  assert.doesNotMatch(serialized, /NaN|Infinity|undefined/);
  assert.equal((serialized.match(/[MLQCZ]/g) || []).length, path.commands.length);
  assert.match(serialized, /M115 0/);
});

test("Неконечные координаты отклоняются до SVGLoader", () => {
  for (const invalid of [Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => serializeGlyphPath({ commands: [{ type: "M", x: invalid, y: 0 }] }), /некорректные координаты/);
  }
});

const zoomSource = fs.readFileSync(new URL('../src/lib/signZoomFocus.ts', import.meta.url), 'utf8');
const zoomCompiled = ts.transpileModule(zoomSource, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const zoomExports = {};
// The 2D helper loads without require, a DOM or Three.js.
new Function('exports', zoomCompiled)(zoomExports);
const focusSource = fs.readFileSync(new URL('../src/lib/signCameraFocus.ts', import.meta.url), 'utf8');
const focusCompiled = ts.transpileModule(focusSource, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const focusExports = {};
new Function('exports', 'require', focusCompiled)(focusExports, id => {
  if (id === 'three') return THREE;
  assert.equal(id, './signZoomFocus'); return zoomExports;
});
const { zoomFocusWeight, signFocusBounds } = focusExports;
const { signZoomTranslation } = zoomExports;
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
const boxCorners = box => [box.min.x, box.max.x].flatMap(x => [box.min.y, box.max.y].flatMap(y => [box.min.z, box.max.z].map(z => new THREE.Vector3(x, y, z))));
const boxMesh = (name, size, position = [0, 0, 0]) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size)); mesh.name = name; mesh.position.set(...position); return mesh;
};

test('Zoom focus preserves the base target below 100% and progresses without a 150% threshold', () => {
  for (const zoom of [.25, .5, .8, 1, 0, -1, NaN, Infinity]) assert.equal(zoomFocusWeight(zoom), 0);
  let previous = 0;
  for (const zoom of [1.01, 1.1, 1.25, 1.5, 2, 3, 4]) {
    const weight = zoomFocusWeight(zoom);
    assert.ok(weight > previous && weight < 1);
    close(weight, 1 - 1 / zoom ** 2, 'Inverse square target blend'); previous = weight;
  }
  assert.ok(zoomFocusWeight(1.5) < 1, 'A 150% zoom must not introduce a sudden centring threshold');
});

test('Letter focus includes physical geometry in world coordinates and excludes whole contextual and optical subtrees', () => {
  const model = new THREE.Group(), physical = new THREE.Group();
  model.position.set(250, 90, -35); model.rotation.set(.1, .43, .12);
  physical.position.set(-180, 35, 10); physical.rotation.y = -.35;
  physical.add(boxMesh('extruded-letter-contours', [1700, 300, 50], [50, 30, 40]),
    boxMesh('extruded-logo', [300, 300, 50], [-1000, 30, 40]), boxMesh('frame-15x15mm', [2000, 15, 15], [-150, -100, 7.5]),
    boxMesh('acp-box', [2400, 600, 100], [-150, 0, -50]));
  model.add(physical);
  for (const name of ['facade', 'facade-front', 'facade-side', 'dimensions', 'panel-mount-context']) {
    const context = new THREE.Group(); context.name = name; context.add(boxMesh('', [100000, 100000, 100000], [10000, -20000, -30000])); model.add(context);
  }
  for (const name of ['photo-facade', 'rear-halo-projection', 'face-light-aura', 'neon-light-spill']) model.add(boxMesh(name, [50000, 50000, 100], [20000, 20000, 400]));
  model.updateWorldMatrix(true, true);
  const expected = new THREE.Box3().setFromObject(physical), actual = signFocusBounds(model);
  close(actual.min.distanceTo(expected.min), 0, 'Physical world minimum'); close(actual.max.distanceTo(expected.max), 0, 'Physical world maximum');
  assert.ok(actual.getSize(new THREE.Vector3()).length() < 5000, 'Large context and glow planes cannot move the zoom anchor');
});

test('The panel body sets the focus after its mounting pose without brackets, contextual walls or artwork children', () => {
  const model = new THREE.Group(), construction = new THREE.Group(); construction.name = 'panel-construction';
  model.position.set(-30, 50, -140); model.rotation.y = .22;
  construction.position.set(400, 120, 700); construction.rotation.y = -Math.PI / 4;
  const panel = boxMesh('panel-body', [550, 550, 160], [0, 0, 80]);
  panel.add(boxMesh('face-light-aura', [15000, 15000, 1], [1000, 3000, 300]));
  construction.add(panel, boxMesh('corner-tie', [3000, 20, 20], [-1500, 0, 80])); model.add(construction);
  model.add(boxMesh('facade-wall', [12000, 8000, 200], [0, -3000, -1000])); model.updateWorldMatrix(true, true);
  const expected = new THREE.Box3().setFromPoints(boxCorners(new THREE.Box3(new THREE.Vector3(-275, -275, -80), new THREE.Vector3(275, 275, 80)))
    .map(point => point.applyMatrix4(panel.matrixWorld)));
  const actual = signFocusBounds(model);
  close(actual.min.distanceTo(expected.min), 0, 'Mounted panel physical minimum'); close(actual.max.distanceTo(expected.max), 0, 'Mounted panel physical maximum');
});

test('Neon focus uses the acrylic outline rather than cables, tubing light or a distant photo', () => {
  const model = new THREE.Group(), neon = new THREE.Group(); neon.rotation.set(.12, .5, 0); neon.position.set(220, 110, 55);
  const backer = boxMesh('transparent-acrylic-backer', [1800, 500, 3], [0, 0, 21.5]);
  neon.add(backer, boxMesh('neon-hanging-cable', [5, 5000, 5], [0, 2800, 24]), boxMesh('neon-light-spill', [9000, 3000, 1], [0, 0, 23.2]));
  model.add(neon, boxMesh('photo-facade', [15000, 9000, 1], [0, -3000, -900])); model.updateWorldMatrix(true, true);
  const expected = new THREE.Box3().setFromObject(backer), actual = signFocusBounds(model);
  close(actual.min.distanceTo(expected.min), 0, 'Acrylic physical minimum'); close(actual.max.distanceTo(expected.max), 0, 'Acrylic physical maximum');
  const empty = new THREE.Group(); empty.add(boxMesh('facade-wall', [5000, 5000, 100]));
  assert.ok(signFocusBounds(empty).isEmpty(), 'A context-only model must not invent a physical sign anchor');
});

function cameraFixture(rotation, direction, aspect = 1.5) {
  const model = new THREE.Group(); model.rotation.y = rotation; model.position.set(-250, 95, -10);
  model.add(boxMesh('extruded-letter-contours', [1800, 350, 60], [650, 1150, 45]));
  const facade = new THREE.Group(); facade.name = 'facade'; facade.add(boxMesh('facade-wall', [12000, 5000, 250], [0, -2000, -2500])); model.add(facade);
  const base = new THREE.Box3().setFromObject(model), baseTarget = base.getCenter(new THREE.Vector3()), signAnchor = signFocusBounds(model).getCenter(new THREE.Vector3());
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 100000);
  camera.position.copy(baseTarget).addScaledVector(direction, 30000); camera.lookAt(baseTarget); camera.updateMatrixWorld(true);
  const projected = boxCorners(base).map(point => point.applyMatrix4(camera.matrixWorldInverse));
  const vertical = Math.max(...projected.map(point => Math.abs(point.y))), horizontal = Math.max(...projected.map(point => Math.abs(point.x)));
  const viewHeight = Math.max(vertical, horizontal / aspect) * 2.4;
  const setZoom = (zoom, nextAspect = aspect, orbitDirection = direction) => {
    camera.left = -viewHeight * nextAspect / 2; camera.right = viewHeight * nextAspect / 2; camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2;
    const target = baseTarget.clone().lerp(signAnchor, zoomFocusWeight(zoom));
    camera.position.copy(target).addScaledVector(orbitDirection, 30000); camera.lookAt(target);
    camera.zoom = zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    return { target, anchorNdc: signAnchor.clone().project(camera) };
  };
  return { camera, baseTarget, signAnchor, setZoom };
}

test('Real orthographic front and oblique views move the sign toward the centre monotonically at every zoom', () => {
  for (const rotation of [0, .5, -1.1]) for (const direction of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(.55, .3, 1).normalize()]) {
    const fixture = cameraFixture(rotation, direction), initial = fixture.setZoom(1);
    close(initial.target.distanceTo(fixture.baseTarget), 0, '100% preserves the whole-context target');
    let previousX = Math.abs(initial.anchorNdc.x), previousY = Math.abs(initial.anchorNdc.y);
    assert.ok(previousX <= 1 && previousY <= 1, 'The fitted contextual view initially contains the sign centre');
    for (const zoom of [1.01, 1.1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4]) {
      const { anchorNdc } = fixture.setZoom(zoom);
      close(anchorNdc.x, initial.anchorNdc.x / zoom, 'Horizontal screen anchor follows 1/zoom');
      close(anchorNdc.y, initial.anchorNdc.y / zoom, 'Vertical screen anchor follows 1/zoom');
      assert.ok(Math.abs(anchorNdc.x) <= previousX + 1e-7 && Math.abs(anchorNdc.y) <= previousY + 1e-7, 'Zooming cannot first push the sign upward or outside the view');
      previousX = Math.abs(anchorNdc.x); previousY = Math.abs(anchorNdc.y);
    }
  }
});

test('Zoom-out preserves the base camera target and high-zoom resize/orbit keeps the physical sign anchor', () => {
  const fixture = cameraFixture(.3, new THREE.Vector3(.55, .3, 1).normalize());
  const initial = fixture.setZoom(1);
  for (const zoom of [.25, .5, .8, 1]) {
    const actual = fixture.setZoom(zoom);
    close(actual.target.distanceTo(fixture.baseTarget), 0, 'Zoom-out never recentres the context');
    close(actual.anchorNdc.x, initial.anchorNdc.x * zoom, 'Normal zoom-out horizontal projection');
    close(actual.anchorNdc.y, initial.anchorNdc.y * zoom, 'Normal zoom-out vertical projection');
  }
  const zoom = 3.2, expectedTarget = fixture.baseTarget.clone().lerp(fixture.signAnchor, zoomFocusWeight(zoom));
  for (const aspect of [.55, 1, 2]) for (const direction of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(.6, .25, 1).normalize()]) {
    const atBase = fixture.setZoom(1, aspect, direction), actual = fixture.setZoom(zoom, aspect, direction);
    assert.equal(fixture.camera.zoom, zoom, 'Changing viewport or orbit must preserve the requested zoom');
    close(actual.target.distanceTo(expectedTarget), 0, 'Resize and orbit preserve the same physical focus target');
    close(actual.anchorNdc.x, atBase.anchorNdc.x / zoom, 'Resized/orbited horizontal anchor');
    close(actual.anchorNdc.y, atBase.anchorNdc.y / zoom, 'Resized/orbited vertical anchor');
  }
});

test('A paired facade zooms toward its primary letters, excluding the companion panel and human', () => {
  const model = new THREE.Group(), primary = new THREE.Group(), companion = new THREE.Group();
  primary.name = 'primary-sign'; companion.name = 'companion-sign';
  const letters = boxMesh('extruded-letter-row-0',[2000,400,60],[100,15,30]); primary.add(letters);
  companion.add(boxMesh('panel-body',[160,550,550],[3200,15,395]));
  model.add(primary,companion,boxMesh('scale-person',[500,1750,300],[1000,-2300,1500]));
  const expected = new THREE.Box3().setFromObject(letters), actual = signFocusBounds(model);
  close(actual.min.distanceTo(expected.min),0,'Focus excludes companion panel'); close(actual.max.distanceTo(expected.max),0,'Focus excludes the scale figure');
});

test('The dependency-free 2D pixel transform has the same progressive focus and unchanged zoom-out target', () => {
  for (const [viewport, anchor] of [[{ width: 1200, height: 800 }, { x: 580, y: 100 }], [{ width: 390, height: 340 }, { x: 195, y: 50 }], [{ width: 1000, height: 600 }, { x: 150, y: 120 }], [{ width: 1200, height: 800 }, { x: 900, y: 650 }]]) {
    const initial = { x: 2 * (anchor.x - viewport.width / 2) / viewport.width, y: 2 * (anchor.y - viewport.height / 2) / viewport.height };
    for (const zoom of [.25, .5, .8, 1, 1.1, 1.25, 1.5, 2, 3, 4]) {
      const translation = signZoomTranslation(anchor, viewport, zoom);
      if (zoom <= 1) assert.deepEqual(translation, { x: 0, y: 0 });
      const screen = { x: viewport.width / 2 + (anchor.x - viewport.width / 2) * zoom + translation.x,
        y: viewport.height / 2 + (anchor.y - viewport.height / 2) * zoom + translation.y };
      const ndc = { x: 2 * (screen.x - viewport.width / 2) / viewport.width, y: 2 * (screen.y - viewport.height / 2) / viewport.height };
      close(ndc.x, initial.x * (zoom <= 1 ? zoom : 1 / zoom), '2D horizontal screen anchor matches the 3D rule');
      close(ndc.y, initial.y * (zoom <= 1 ? zoom : 1 / zoom), '2D vertical screen anchor matches the 3D rule');
      assert.ok(Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1, 'Focusing cannot send a visible sign anchor out of its viewport');
    }
  }
});
