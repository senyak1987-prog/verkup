import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function load(path, dependencies = {}) {
  const source = fs.readFileSync(new URL('../src/' + path + '.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, id => {
    assert.ok(id in dependencies, 'Unknown RC test dependency: ' + id);
    return dependencies[id];
  });
  return exports;
}

const panel = load('lib/panelConstruction');
const facade = load('lib/signFacade', { './panelConstruction': panel });
const architecture = load('lib/signFacade3D', { three: THREE, './signFacade': facade, './panelConstruction': panel });
const placement = load('rc-game/facadePlacement', { three: THREE });
const physics = load('rc-game/physics');
const terrain = load('rc-game/terrain');
const worlds = load('rc-game/world', {
  three: THREE,
  'three/examples/jsm/geometries/RoundedBoxGeometry.js': { RoundedBoxGeometry },
  './physics': physics,
  './terrain': terrain,
});
const places = facade.SIGN_PLACEMENTS.filter(item => item.id !== 'none').map(item => item.id);
const close = (actual, expected, label, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
};
const named = (root, name) => {
  const items = [];
  root.traverse(object => { if (object.name === name) items.push(object); });
  return items;
};
const bounds = object => new THREE.Box3().setFromObject(object);
const boardBounds = pose => new THREE.Box3(new THREE.Vector3(-11.35, -.42, -11.35), new THREE.Vector3(11.35, 2, 11.35))
  .applyMatrix4(pose.matrix);

function dispose(root) {
  const geometries = new Set(), materials = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  root.clear();
}

test('A game is unavailable without both a physical building wall and its pavement', () => {
  const empty = architecture.createFacadeModel('none', 1800, 400);
  const sample = architecture.createPanelMountContext({ mode: 'wall', size: 550, depth: 160, gap: 120 });
  assert.equal(placement.facadeRcPlacement(empty), null);
  assert.equal(placement.facadeRcPlacement(sample), null, 'A cropped mounting sample cannot become an arena location');
  for (const missing of ['facade-wall', 'facade-pavement']) {
    const building = architecture.createFacadeModel('shop', 1800, 400);
    const removed = building.getObjectByName(missing);
    removed.removeFromParent();
    assert.equal(placement.facadeRcPlacement(building), null, 'Incomplete architecture has no safe placement');
    dispose(removed); dispose(building);
  }
  dispose(empty); dispose(sample);
});

test('Every facade anchors the arena to its actual ground and leaves architectural obstacles clear', () => {
  for (const place of places) for (const { id: palette } of facade.FACADE_PALETTES) for (const signBackMm of [0, 30, 100]) {
    const building = architecture.createFacadeModel(place, 1800, 400, { palette, signBackMm });
    const pose = placement.facadeRcPlacement(building);
    assert.ok(pose, `${place}/${palette}/${signBackMm} must have an arena`);
    assert.ok(pose.matrix.elements.every(Number.isFinite));
    const origin = new THREE.Vector3().setFromMatrixPosition(pose.matrix);
    const pavement = bounds(building.getObjectByName('facade-pavement'));
    close(origin.y, pavement.max.y, 'Driving surface follows the real pavement top');
    close(pose.ground, pavement.max.y, 'Ground metadata agrees with the architecture');
    const arena = boardBounds(pose);
    assert.ok(arena.min.z - pavement.max.z >= 150, 'A useful gap separates the track and shop pavement');
    const wall = bounds(building.getObjectByName('facade-wall'));
    assert.ok(origin.x > wall.getCenter(new THREE.Vector3()).x, 'The track is on the front-right of the building');
    assert.ok(arena.min.x < wall.max.x && arena.max.x > wall.max.x, 'The board straddles the right edge without adding its entire width to the view');
    building.traverse(object => {
      if (object.name === 'facade-wall' || object.name === 'facade-pavement' || object.name.startsWith('facade-entrance-step-')
        || object.name.startsWith('facade-canopy-column-') || object.name === 'facade-planter-box') {
        assert.equal(arena.intersectsBox(bounds(object)), false, `${place}: arena cannot intersect ${object.name}`);
      }
    });
    dispose(building);
  }
});

test('Corner mounts use the front wall and clear pavements on both sides of the building', () => {
  for (const place of places) for (const mode of ['wall', 'corner', 'corner-front', 'corner-side']) {
    const panelMount = panel.panelMountLayout(550, 'circle', 120, 60, 160, mode);
    const building = architecture.createFacadeModel(place, 1800, 400, { panelMount, frontSign: true });
    const pose = placement.facadeRcPlacement(building);
    assert.ok(pose, `${place}/${mode} must support gameplay`);
    const arena = boardBounds(pose);
    for (const pavement of named(building, 'facade-pavement')) {
      const ground = bounds(pavement);
      assert.equal(arena.intersectsBox(ground), false, 'Neither front nor return pavement intersects the track');
      assert.ok(arena.min.z - ground.max.z >= 150, 'The complete corner courtyard stays behind the board');
    }
    const front = building.getObjectByName('facade-front') ?? building;
    const frontWall = bounds(front.getObjectByName('facade-wall'));
    const origin = new THREE.Vector3().setFromMatrixPosition(pose.matrix);
    assert.ok(origin.x > frontWall.getCenter(new THREE.Vector3()).x, 'The primary front wall determines front-right placement');
    close(origin.y, bounds(front.getObjectByName('facade-pavement')).max.y, 'Corner ground comes from the primary pavement');
    dispose(building);
  }
});

test('World placement preserves translated and rotated ancestors without applying their transform twice', () => {
  const building = architecture.createFacadeModel('canopy', 1800, 400, {
    panelMount: panel.panelMountLayout(550, 'circle', 120, 60, 160, 'corner-front'), frontSign: true,
  });
  const reference = placement.facadeRcPlacement(building);
  assert.ok(reference);
  const parent = new THREE.Group(); parent.position.set(720, -450, 1600); parent.rotation.set(.11, .73, -.06);
  const grandparent = new THREE.Group(); grandparent.position.set(-530, 300, -870); grandparent.rotation.set(-.04, -.29, .09);
  building.position.set(160, 80, -220); building.rotation.set(.03, -.18, .02);
  parent.add(building); grandparent.add(parent);
  const transformed = placement.facadeRcPlacement(building);
  assert.ok(transformed);
  close(transformed.ground, reference.ground, 'Ground metadata remains in the facade frame');
  close(transformed.front, reference.front, 'Courtyard metadata remains in the facade frame');
  for (const point of [new THREE.Vector3(), new THREE.Vector3(-11.35, 0, 11.35), new THREE.Vector3(3.1, 1.7, -4.2)]) {
    const expected = point.clone().applyMatrix4(reference.matrix).applyMatrix4(building.matrixWorld);
    const actual = point.clone().applyMatrix4(transformed.matrix);
    close(actual.distanceTo(expected), 0, 'An arena point inherits the complete facade transform');
  }
  const normal = new THREE.Vector3(0, 1, 0).transformDirection(transformed.matrix);
  const groundNormal = new THREE.Vector3(0, 1, 0).transformDirection(building.matrixWorld);
  close(normal.distanceTo(groundNormal), 0, 'The driving plane follows the ground orientation');
  dispose(grandparent);
});

test('Changing sign dimensions never changes the physical board or vehicle scale', () => {
  for (const place of places) {
    const small = architecture.createFacadeModel(place, 600, 180, { signBackMm: 100 });
    const large = architecture.createFacadeModel(place, 8000, 1200, { signBackMm: 100 });
    const a = placement.facadeRcPlacement(small), b = placement.facadeRcPlacement(large);
    assert.ok(a && b);
    for (let index = 0; index < 16; index++) close(a.matrix.elements[index], b.matrix.elements[index], 'Oversized signs cannot resize or move the game');
    const scale = new THREE.Vector3().setFromMatrixScale(a.matrix);
    close(scale.x, scale.y, 'Suspension travel uses the same scale as the body');
    close(scale.y, scale.z, 'The arena and car preserve their proportions');
    close(scale.x, placement.FACADE_RC_SCALE, 'Physical scaling remains stable across products');
    dispose(small); dispose(large);
  }
});

test('Real shared RC geometry becomes a roughly 4.5 metre board and a 32 centimetre toy car', () => {
  // Rendering paint is irrelevant to geometry; this tiny canvas stub lets the real
  // world factory run in Node without creating a browser or a second renderer.
  const previousDocument = globalThis.document;
  const paint = { clearRect() {}, setLineDash() {}, beginPath() {}, roundRect() {}, stroke() {}, fillText() {}, fillRect() {}, arc() {}, fill() {} };
  globalThis.document = { createElement(name) { assert.equal(name, 'canvas'); return { width: 0, height: 0, getContext() { return paint; } }; } };
  let world;
  try { world = worlds.createRcWorld(); }
  finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
  const building = architecture.createFacadeModel('shop', 1800, 400);
  try {
    const pose = placement.facadeRcPlacement(building);
    assert.ok(pose);
    pose.matrix.decompose(world.group.position, world.group.quaternion, world.group.scale);
    const car = world.group.getObjectByName('rc-car');
    assert.ok(car, 'The reusable arena includes the original detailed car');
    car.rotation.y = 0;
    world.group.updateWorldMatrix(true, true);
    const size = bounds(car).getSize(new THREE.Vector3());
    assert.ok(size.z >= 250 && size.z <= 350, `Toy car length ${size.z.toFixed(1)} mm stays believable beside the building`);
    assert.ok(size.x >= 180 && size.x <= 300, 'Toy car width remains proportionate');
    const tableSize = bounds(world.group.children[0]).getSize(new THREE.Vector3());
    assert.ok(tableSize.x >= 4500 && tableSize.x <= 5700, 'The actual board is a small courtyard track');
    close(tableSize.x, tableSize.z, 'The board retains its square proportions', .001);
    close(tableSize.x, placement.FACADE_RC_SIZE, 'Placement footprint matches the rendered table', .001);
  } finally { world.dispose(); dispose(building); }
});
