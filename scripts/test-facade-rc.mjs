import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

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
const terrain = load('rc-game/terrain');
const physics = load('rc-game/physics');
const surfaces = load('rc-game/terrainSurface', { './terrain': terrain });
const placement = load('rc-game/facadePlacement', { three: THREE, './terrainSurface': surfaces });
const props = load('rc-game/propsPhysics', { 'cannon-es': CANNON });
const truck = load('rc-game/trxTruck', { three: THREE,
  'three/examples/jsm/geometries/RoundedBoxGeometry.js': { RoundedBoxGeometry } });
const worldApi = load('rc-game/world', { three: THREE, './physics': physics,
  './terrainSurface': surfaces, './propsPhysics': props, './trxTruck': truck,
  'three/examples/jsm/geometries/RoundedBoxGeometry.js': { RoundedBoxGeometry } });
const gameApi = load('rc-game/facadeGame', { three: THREE, './world': worldApi, './facadePlacement': placement });
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
const point = (pose, x, z, y = 0) => new THREE.Vector3(x, y, z).applyMatrix4(pose.matrix);
const inside = (region, x, z) => x >= region.minX && x <= region.maxX && z >= region.minZ && z <= region.maxZ;

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

test('Every facade has a playground across the full house width, connected to its real pavement', () => {
  for (const place of places) for (const { id: palette } of facade.FACADE_PALETTES) for (const signBackMm of [0, 30, 100]) {
    const building = architecture.createFacadeModel(place, 1800, 400, { palette, signBackMm });
    const pose = placement.facadeRcPlacement(building);
    assert.ok(pose, `${place}/${palette}/${signBackMm} must have an arena`);
    assert.ok(pose.matrix.elements.every(Number.isFinite));
    const origin = new THREE.Vector3().setFromMatrixPosition(pose.matrix);
    const pavement = bounds(building.getObjectByName('facade-pavement'));
    close(origin.y, pavement.max.y, 'Driving surface follows the real pavement top');
    close(pose.ground, pavement.max.y, 'Ground metadata agrees with the architecture');
    const wall = bounds(building.getObjectByName('facade-wall'));
    close(origin.x, wall.getCenter(new THREE.Vector3()).x, 'Playground is centred on the full house frontage');
    close(pose.surface.width * placement.FACADE_RC_SCALE, wall.max.x - wall.min.x, 'Playground spans the entire house');
    const rear = point(pose, pose.surface.bounds.minX, pose.surface.bounds.minZ);
    const far = point(pose, pose.surface.bounds.maxX, pose.surface.bounds.maxZ);
    close(rear.x, wall.min.x, 'The left edge reaches the house left edge');
    close(far.x, wall.max.x, 'The right edge reaches the house right edge');
    assert.ok(rear.z > wall.max.z && rear.z < wall.max.z + 150, 'Rear driving boundary reaches the stairs without entering the building');
    close(far.z - pavement.max.z, 4400, 'The new apron extends 4.4 metres in front of the pavement');
    assert.ok(pose.surface.platforms.some(top => top.name === 'facade-pavement'));
    assert.equal(pose.surface.platforms.filter(top => top.name.startsWith('facade-entrance-step-')).length, 3);
    assert.ok(pose.surface.barriers.some(item => item.name === 'facade-planter-box'), 'Existing planters remain solid architecture');
    dispose(building);
  }
});

test('Corner mounts follow the full primary front wall and keep the return wall behind the driving area', () => {
  for (const place of places) for (const mode of ['wall', 'corner', 'corner-front', 'corner-side']) {
    const panelMount = panel.panelMountLayout(550, 'circle', 120, 60, 160, mode);
    const building = architecture.createFacadeModel(place, 1800, 400, { panelMount, frontSign: true });
    const pose = placement.facadeRcPlacement(building);
    assert.ok(pose, `${place}/${mode} must support gameplay`);
    const rear = point(pose, pose.surface.bounds.minX, pose.surface.bounds.minZ);
    const far = point(pose, pose.surface.bounds.maxX, pose.surface.bounds.maxZ);
    let courtyardFront = -Infinity;
    for (const pavement of named(building, 'facade-pavement')) {
      const ground = bounds(pavement);
      courtyardFront = Math.max(courtyardFront, ground.max.z);
    }
    const front = building.getObjectByName('facade-front') ?? building;
    const frontWall = bounds(front.getObjectByName('facade-wall'));
    const origin = new THREE.Vector3().setFromMatrixPosition(pose.matrix);
    close(origin.x, frontWall.getCenter(new THREE.Vector3()).x, 'The primary front wall centres the arena');
    close(rear.x, frontWall.min.x, 'Corner left edge follows the front wall');
    close(far.x, frontWall.max.x, 'Corner right edge follows the front wall');
    close(far.z - courtyardFront, 4400, 'Corner pavement joins the new apron');
    assert.ok(rear.z > frontWall.max.z, 'The rear bound does not enter either corner wall');
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
    assert.deepEqual(a.surface.bounds, b.surface.bounds);
    const scale = new THREE.Vector3().setFromMatrixScale(a.matrix);
    close(scale.x, scale.y, 'Suspension travel uses the same scale as the body');
    close(scale.y, scale.z, 'The arena and car preserve their proportions');
    close(scale.x, placement.FACADE_RC_SCALE, 'Physical scaling remains stable across products');
    dispose(small); dispose(large);
  }
});

test('Wheel and rigid body heights match each real staircase tread and entrance threshold', () => {
  for (const place of places) {
    const building = architecture.createFacadeModel(place, 1800, 400);
    const pose = placement.facadeRcPlacement(building);
    assert.ok(pose);
    const inverse = pose.matrix.clone().invert();
    const heights = [];
    for (const mesh of named(building, 'facade-entrance-step-1').concat(named(building, 'facade-entrance-step-2'), named(building, 'facade-entrance-step-3'))) {
      const actual = bounds(mesh);
      // Probe the exposed front strip of each nested tread, beyond the higher tread.
      const contact = new THREE.Vector3((actual.min.x + actual.max.x) / 2, actual.max.y, actual.max.z - 15).applyMatrix4(inverse);
      close(pose.surface.height(contact.x, contact.z), contact.y, `${place}: ${mesh.name} uses the actual mesh top`);
      assert.ok(inside(pose.surface.bounds, contact.x, contact.z), 'Every tread is inside the driveable playground');
      heights.push(contact.y);
    }
    assert.deepEqual(heights.map(y => Math.round(y * 100) / 100), [2.25, 1.5, .75]);
    const threshold = pose.surface.platforms.find(top => top.name === 'facade-entrance-threshold');
    assert.ok(threshold);
    const x = (threshold.minX + threshold.maxX) / 2, z = (threshold.minZ + threshold.maxZ) / 2;
    close(pose.surface.height(x, z), threshold.height, 'The top landing meets the actual entrance threshold');
    dispose(building);
  }
});

test('The new rendered ground joins the pavement without hiding any existing staircase', () => {
  for (const place of places) {
    const building = architecture.createFacadeModel(place, 1800, 400);
    const pose = placement.facadeRcPlacement(building);
    const apron = pose.surface.floorRegions[0];
    const start = point(pose, 0, apron.minZ);
    close(start.z, pose.front, 'The apron starts exactly at the pavement edge');
    for (const top of pose.surface.platforms) if (top.name.startsWith('facade-entrance-')) {
      assert.ok(top.maxZ < apron.minZ, 'A staircase stays visible and is not covered by a second ground plane');
    }
    assert.ok(inside(apron, pose.surface.spawn.x, pose.surface.spawn.z), 'The car starts on the clear, flat apron');
    close(pose.surface.height(pose.surface.spawn.x, pose.surface.spawn.z), 0, 'The start does not intersect the staircase');
    for (const checkpoint of pose.surface.checkpoints) assert.ok(inside(apron, checkpoint.x, checkpoint.z));
    dispose(building);
  }
});

test('The RC truck can climb the actual entrance staircase with wheel contacts above the treads', () => {
  for (const place of places) {
    const building = architecture.createFacadeModel(place, 1800, 400);
    const surface = placement.facadeRcPlacement(building).surface;
    const lowest = surface.platforms.find(top => top.name === 'facade-entrance-step-3');
    const highest = surface.platforms.find(top => top.name === 'facade-entrance-step-1');
    const x = (lowest.minX + lowest.maxX) / 2;
    const car = new physics.RcPhysics(surface.height, { bounds: surface.bounds,
      spawn: { x, z: lowest.maxZ + 3, yaw: Math.PI } });
    let reachedTop = false;
    for (let tick = 0; tick < 720; tick++) {
      car.step(1 / 120, { target: null, throttle: 1, brake: false, reverse: false, steer: 0 });
      const s = car.state;
      assert.ok(Object.values(s).filter(value => typeof value === 'number').every(Number.isFinite), 'A stair contact remains stable');
      if (inside(highest, s.x, s.z) && surface.height(s.x, s.z) >= highest.height) reachedTop = true;
      for (const wheel of s.wheels) {
        const wx = s.x + wheel.x * Math.cos(s.yaw) + wheel.z * Math.sin(s.yaw);
        const wz = s.z - wheel.x * Math.sin(s.yaw) + wheel.z * Math.cos(s.yaw);
        const centreY = s.y + wheel.height + wheel.x * Math.sin(s.roll) - wheel.z * Math.sin(s.pitch);
        assert.ok(centreY >= surface.height(wx, wz) + physics.WHEEL_RADIUS - .011,
          `${place}: a wheel cannot be buried in the staircase`);
      }
    }
    assert.ok(reachedTop, `${place}: driving forward reaches the top landing`);
    dispose(building);
  }
});

test('The truck body stays outside real columns and planters at straight and angled headings', () => {
  // Canvas drawing is irrelevant to this collision test; retain the complete
  // rendered truck geometry so Box3 checks its actual front and side extents.
  const originalDocument = globalThis.document;
  const context = new Proxy({}, { get: (object, key) => object[key] ?? (() => {}),
    set: (object, key, value) => { object[key] = value; return true; } });
  globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
  const building = architecture.createFacadeModel('canopy', 1800, 400);
  let world;
  try {
    const surface = placement.facadeRcPlacement(building).surface;
    world = worldApi.createRcWorld({ surface: { ...surface, props: [] } });
    const column = surface.barriers.find(barrier => barrier.name === 'facade-canopy-column-left');
    const planter = surface.barriers.find(barrier => barrier.name === 'facade-planter-box' && barrier.minX > 0);
    assert.ok(column && planter, 'The test uses the real facade architecture');
    for (const barrier of [column, planter]) {
      const cases = barrier === column
        ? [{ yaw: 0, reverse: false }, { yaw: Math.PI / 2, reverse: false }, { yaw: Math.PI / 4, reverse: false }]
        : [{ yaw: 0, reverse: true }, { yaw: Math.PI / 2, reverse: false }, { yaw: -Math.PI / 4, reverse: true }];
      for (const { yaw, reverse } of cases) {
        world.reset();
        const direction = reverse ? -1 : 1;
        Object.assign(world.physics.state, {
          x: (barrier.minX + barrier.maxX) / 2 - Math.sin(yaw) * direction * 3,
          z: (barrier.minZ + barrier.maxZ) / 2 - Math.cos(yaw) * direction * 3,
          yaw,
        });
        const input = { target: null, throttle: 1, brake: false, reverse, steer: 0 };
        let collision = 0;
        for (let tick = 0; tick < 360; tick++) {
          world.step(1 / 120, input);
          collision = Math.max(collision, world.physics.state.collision);
        }
        assert.ok(collision > .05, `${barrier.name}/${yaw}: the architecture must stop an approaching truck`);
        world.update(input, 0, false);
        world.group.updateMatrixWorld(true);
        const truckBounds = bounds(world.group.getObjectByName('rc-car'));
        const clear = truckBounds.max.x <= barrier.minX + .01 || truckBounds.min.x >= barrier.maxX - .01
          || truckBounds.max.z <= barrier.minZ + .01 || truckBounds.min.z >= barrier.maxZ - .01;
        assert.ok(clear, `${barrier.name}/${yaw}: the rendered truck cannot remain inside the solid architecture`);
      }
    }
  } finally {
    world?.dispose();
    dispose(building);
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('Rear facade cameras keep opaque architecture out of the truck view in every heading', () => {
  for (const place of ['shop', 'canopy']) {
    const building = architecture.createFacadeModel(place, 1800, 400);
    try {
      const pose = placement.facadeRcPlacement(building);
      const surface = pose.surface;
      const highest = surface.platforms.find(top => top.name === 'facade-entrance-step-1');
      const locations = [surface.spawn, { x: (highest.minX + highest.maxX) / 2, z: highest.maxZ - .9 }];
      const obstacles = [];
      building.traverse(object => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some(material => material.visible && (!material.transparent || material.opacity >= .98))) obstacles.push(object);
      });
      const up = new THREE.Vector3(0, 1, 0).transformDirection(pose.matrix);
      for (const { x, z } of locations) for (const yaw of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
        const car = new physics.RcPhysics(surface.height, { bounds: surface.bounds, spawn: { x, z, yaw } });
        const target = new THREE.Vector3(car.state.x, car.state.y + .35, car.state.z).applyMatrix4(pose.matrix);
        const rear = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).transformDirection(pose.matrix);
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).transformDirection(pose.matrix);
        const scale = placement.FACADE_RC_SCALE;
        const camera = gameApi.facadeRearCameraPosition(target, rear, up, right, scale, obstacles);
        const offset = camera.clone().sub(target);
        assert.ok(offset.dot(rear) > 0, 'The camera remains behind the current heading');
        close(offset.dot(right), 0, 'Collision avoidance cannot turn a rear camera into a side camera');
        assert.ok(offset.length() >= scale * 1.55 - .01, 'The near plane stays outside the truck');
        const samples = [target, target.clone().addScaledVector(right, scale * .65),
          target.clone().addScaledVector(right, -scale * .65), target.clone().addScaledVector(up, -scale * .42),
          target.clone().addScaledVector(up, scale * .32)];
        for (const sample of samples) {
          const direction = sample.clone().sub(camera);
          const ray = new THREE.Raycaster(camera, direction.clone().normalize(), 0, direction.length() - .01);
          const hit = ray.intersectObjects(obstacles, false)[0];
          assert.ok(!hit, `${place}/${x},${z}/${yaw}: ${hit?.object.name} blocks the rear view of the truck`);
        }
      }
    } finally { dispose(building); }
  }
});

test('Standalone and facade layouts contain independent physical cones, tyre piles and gate bollards', () => {
  const building = architecture.createFacadeModel('shop', 1800, 400);
  const surfaceList = [surfaces.createDefaultRcSurface(), placement.facadeRcPlacement(building).surface];
  for (const surface of surfaceList) {
    assert.equal(new Set(surface.props.map(prop => prop.id)).size, surface.props.length);
    assert.equal(surface.props.filter(prop => prop.kind === 'cone').length, 4);
    assert.equal(surface.props.filter(prop => prop.kind === 'tire').length, 9);
    assert.equal(surface.props.filter(prop => prop.kind === 'bollard').length, 12);
    for (const prop of surface.props) {
      assert.ok(inside(surface.bounds, prop.x, prop.z), 'Physical props start inside the arena');
      assert.ok(prop.radius > 0 && prop.height > 0 && prop.mass > 0);
    }
    for (let pile = 0; pile < 3; pile++) {
      const tyres = surface.props.filter(prop => prop.id.startsWith(`tire-${pile}-`));
      assert.equal(tyres.length, 3);
      assert.ok(tyres[0].y < tyres[1].y && tyres[1].y < tyres[2].y, 'Each tyre has its own height and can separate from the pile');
    }
  }
  dispose(building);
});
