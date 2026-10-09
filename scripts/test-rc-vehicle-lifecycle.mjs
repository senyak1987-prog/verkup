import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

function load(path, dependencies = {}) {
  const source = fs.readFileSync(new URL('../src/rc-game/' + path + '.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => {
    assert.ok(name in dependencies, 'Unknown lifecycle test dependency: ' + name);
    return dependencies[name];
  });
  return exports;
}

const physics = load('physics');
const terrain = load('terrain');
const surfaces = load('terrainSurface', { './terrain': terrain });
const placement = load('facadePlacement', { three: THREE, './terrainSurface': surfaces });
const props = load('propsPhysics', { 'cannon-es': CANNON });
const wordmark = load('brandWordmark');
const truck = load('trxTruck', { three: THREE, './brandWordmark': wordmark,
  'three/examples/jsm/geometries/RoundedBoxGeometry.js': { RoundedBoxGeometry } });
const suspension = load('trxSuspension', { three: THREE });
const ground = load('arenaGround', { three: THREE, './terrainSurface': surfaces,
  'three/examples/jsm/geometries/RoundedBoxGeometry.js': { RoundedBoxGeometry } });
const effects = load('vehicleEffects', { three: THREE });
const worldApi = load('world', { three: THREE, './physics': physics,
  './terrainSurface': surfaces, './propsPhysics': props, './trxTruck': truck, './trxSuspension': suspension,
  './arenaGround': ground, './vehicleEffects': effects,
  'three/examples/jsm/geometries/RoundedBoxGeometry.js': { RoundedBoxGeometry } });
const facadeApi = load('facadeGame', { three: THREE, './world': worldApi, './facadePlacement': placement });
const { TRX_VEHICLE_PROFILE } = load('trxAssetProfile');
const idle = { target: null, throttle: 0, brake: false, reverse: false };
const flushJobs = () => new Promise(resolve => setImmediate(resolve));
const close = (actual, expected, message, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

class CanvasStub extends EventTarget {
  width = 1; height = 1; clientWidth = 800; clientHeight = 600; tabIndex = -1;
  attributes = new Map(); captures = new Set();
  context = new Proxy({
    measureText: text => ({ width: String(text).length * 8 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => target[key] ?? (() => {}),
    set: (target, key, value) => { target[key] = value; return true; } });
  getContext() { return this.context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  focus() {}
}

async function withDom(run) {
  const names = ['document', 'window', 'localStorage'];
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const document = new EventTarget();
  document.createElement = tag => { assert.equal(tag, 'canvas'); return new CanvasStub(); };
  const stored = new Map();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true,
    value: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)) } });
  try { return await run(); }
  finally {
    names.forEach((name, index) => {
      if (originals[index]) Object.defineProperty(globalThis, name, originals[index]);
      else delete globalThis[name];
    });
  }
}

function fakeRig(name) {
  const body = new THREE.Group(); body.name = name + '-body';
  const paint = new THREE.MeshStandardMaterial({ color: '#354555', emissive: '#123456', emissiveIntensity: .35 });
  const geometry = new THREE.BoxGeometry(.7, .45, 1.8);
  body.add(new THREE.Mesh(geometry, paint));
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: '#202428', emissive: '#071109', emissiveIntensity: .2 });
  const wheelGeometry = new THREE.CylinderGeometry(.15, .15, .09, 8);
  const rotors = Array.from({ length: 4 }, (_, index) => {
    const rotor = new THREE.Group(); rotor.name = `${name}-rotor-${index}`;
    rotor.add(new THREE.Mesh(wheelGeometry, wheelMaterial)); return rotor;
  });
  const resources = [geometry, paint, wheelGeometry, wheelMaterial];
  const disposal = new Map(resources.map(resource => [resource, 0]));
  resources.forEach(resource => resource.addEventListener('dispose', () => disposal.set(resource, disposal.get(resource) + 1)));
  const stats = { dispose: 0, colors: [] };
  const originalEmissive = paint.emissive.clone(), originalIntensity = paint.emissiveIntensity;
  return {
    body, rotors, paint, stats, disposal, originalEmissive, originalIntensity,
    setColor(hex) { stats.colors.push(hex); paint.color.set(hex); },
    dispose() {
      stats.dispose++;
      body.removeFromParent(); rotors.forEach(rotor => rotor.removeFromParent());
      resources.forEach(resource => resource.dispose());
    },
  };
}

const flatSurface = () => ({
  width: 16, depth: 16, bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, height: () => 0,
  platforms: [], barriers: [], props: [], checkpoints: [{ x: 5, z: 3 }, { x: -5, z: -3 }],
  spawn: { x: 0, z: 0, yaw: 0 },
});

function facadeBuilding(name) {
  const group = new THREE.Group(); group.name = name;
  const material = new THREE.MeshStandardMaterial({ color: '#979c9a' });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6000, 4000, 220), material);
  wall.name = 'facade-wall'; wall.position.y = 2000; group.add(wall);
  const pavement = new THREE.Mesh(new THREE.BoxGeometry(6000, 150, 1800), material);
  pavement.name = 'facade-pavement'; pavement.position.set(0, -75, 900); group.add(pavement);
  return group;
}

function disposeBuilding(building) {
  const materials = new Set();
  building.traverse(object => {
    object.geometry?.dispose();
    if (object.material) materials.add(object.material);
  });
  materials.forEach(material => material.dispose()); building.removeFromParent();
}

function facadeHarness(loadVehicle) {
  const scene = new THREE.Scene(), canvas = new CanvasStub();
  const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, .1, 100000);
  camera.position.set(0, 5000, 9000); camera.lookAt(0, 1000, 0);
  const controls = { target: new THREE.Vector3(0, 1000, 0), enabled: true };
  const stats = { renders: 0, geometry: 0, errors: [], telemetry: [] };
  const game = facadeApi.createFacadeRcGame({ scene, canvas, camera, controls,
    vehicleProfile: TRX_VEHICLE_PROFILE, loadVehicle,
    requestRender: () => stats.renders++, onGeometryChange: () => stats.geometry++,
    onActive() {}, onTelemetry: value => stats.telemetry.push(value), onVehicleError: error => stats.errors.push(error),
  });
  return { scene, canvas, camera, controls, stats, game };
}

test('A deferred vehicle replaces body and all four rotors with the latest color without resetting physics', async () => withDom(async () => {
  const pending = deferred(), rig = fakeRig('ready');
  let ready = 0;
  const world = worldApi.createRcWorld({ surface: flatSurface(), vehicleProfile: TRX_VEHICLE_PROFILE,
    loadVehicle: () => pending.promise, onVehicleReady: () => ready++ });
  try {
    await flushJobs();
    for (let tick = 0; tick < 60; tick++) world.step(1 / 120, { ...idle, throttle: 1, steer: .45 });
    world.setColor('#173e31'); world.setColor('#ef6b35');
    const before = structuredClone(world.physics.state);
    const antenna = world.physics.state.antenna;
    pending.resolve(rig); await flushJobs();
    assert.equal(ready, 1);
    assert.deepEqual(world.physics.state, before, 'Async visual readiness must not change position, momentum, suspension or antenna');
    assert.equal(world.physics.state.antenna, antenna);
    assert.deepEqual(rig.stats.colors, ['#ef6b35']);
    assert.equal(rig.paint.color.getHexString(), 'ef6b35');
    assert.equal(rig.body.parent.name, 'rc-chassis');
    assert.deepEqual([...rig.body.scale], [2, 2, 2], 'The downloaded body inherits the playable vehicle scale');
    assert.equal(world.group.getObjectByName('rc-procedural-body'), undefined);
    rig.rotors.forEach((rotor, index) => {
      const hub = world.group.getObjectByName(`rc-wheel-hub-${index}`), wheel = before.wheels[index];
      assert.equal(rotor.parent, hub);
      assert.deepEqual([...rotor.scale], [2, 2, 2], 'Wheel geometry matches the enlarged physics hubs');
      assert.deepEqual([...hub.position], [wheel.x, wheel.height, wheel.z]);
      close(hub.rotation.y, index < 2 ? wheel.steer : 0, 'The replacement keeps individual steering');
      close(rotor.rotation.x, wheel.spin ?? before.wheelSpin, 'The replacement keeps independent wheel rotation');
      assert.equal(hub.children.length, 1, 'A placeholder rotor cannot remain inside the live hub');
    });
    world.setColor('#4b6a88'); assert.equal(rig.paint.color.getHexString(), '4b6a88');
  } finally { world.dispose(); }
  assert.equal(rig.stats.dispose, 1);
  for (const count of rig.disposal.values()) assert.equal(count, 1);
}));

test('Dust follows loaded wheels on sand, is suppressed on pavers, and headlights illuminate the scene at night',async()=>withDom(async()=>{
  for(const kind of ['sand','pavers']){
    const surface={...flatSurface(),groundKind:()=>kind};
    const world=worldApi.createRcWorld({surface,vehicleProfile:TRX_VEHICLE_PROFILE});
    try{
      for(let i=0;i<90;i++){world.step(1/120,{...idle,throttle:1,steer:0});world.update(idle,1/120,false);}
      const dust=world.group.getObjectByName('rc-wheel-dust'), active=[...dust.geometry.attributes.puffAlpha.array].filter(alpha=>alpha>0);
      if(kind==='sand')assert.ok(active.length>8,'Sand contacts produce a real particle trail');
      else assert.equal(active.length,0,'Paved contacts must not produce sand dust');
      const lamp=world.group.getObjectByName('rc-headlight--1'), day=lamp.intensity;
      world.setLighting(1);assert.ok(lamp.intensity>day*4,'Night lighting casts stronger real headlight beams');
      assert.equal(lamp.isSpotLight,true);assert.ok(lamp.distance>0);
      world.reset();assert.ok([...dust.geometry.attributes.puffAlpha.array].every(alpha=>alpha===0),'Reset removes the old dust trail');
    }finally{world.dispose();}
  }
}));

test('Destroying a world disposes a delayed rig without attaching it or announcing readiness', async () => withDom(async () => {
  const pending = deferred(), rig = fakeRig('destroyed');
  let ready = 0, failed = 0;
  const world = worldApi.createRcWorld({ surface: flatSurface(), loadVehicle: () => pending.promise,
    onVehicleReady: () => ready++, onVehicleError: () => failed++ });
  await flushJobs(); world.dispose();
  pending.resolve(rig); await flushJobs(); world.dispose();
  assert.equal(ready, 0); assert.equal(failed, 0);
  assert.equal(rig.stats.dispose, 1); assert.deepEqual(rig.stats.colors, []);
  assert.equal(rig.body.parent, null); assert.ok(rig.rotors.every(rotor => rotor.parent === null));
  assert.equal(world.group.children.length, 0);
  for (const count of rig.disposal.values()) assert.equal(count, 1);
}));

test('Replacing a facade disposes stale delayed rigs and attaches only the current building rig', async () => withDom(async () => {
  const tickets = [], rigs = [fakeRig('initial-stale'), fakeRig('facade-a-stale'), fakeRig('facade-b-current')];
  const harness = facadeHarness(() => { const ticket = deferred(); tickets.push(ticket); return ticket.promise; });
  const a = facadeBuilding('building-a'), b = facadeBuilding('building-b');
  harness.scene.add(a, b);
  try {
    harness.game.setFacade(a); harness.game.setFacade(b);
    await flushJobs();
    assert.equal(tickets.length, 3, 'Initial arena and both facade rebuilds each requested a rig');
    tickets[1].resolve(rigs[1]); tickets[0].resolve(rigs[0]); await flushJobs();
    assert.equal(rigs[0].stats.dispose, 1); assert.equal(rigs[1].stats.dispose, 1);
    assert.equal(harness.game.group.getObjectByName(rigs[0].body.name), undefined);
    assert.equal(harness.game.group.getObjectByName(rigs[1].body.name), undefined);
    assert.equal(harness.game.group.children.length, 1, 'A rebuilt facade retains exactly one live arena');
    tickets[2].resolve(rigs[2]); await flushJobs();
    assert.equal(harness.game.group.getObjectByName(rigs[2].body.name), rigs[2].body);
    assert.equal(rigs[2].stats.dispose, 0);
    assert.deepEqual(harness.stats.errors, []);
  } finally {
    harness.game.dispose(); disposeBuilding(a); disposeBuilding(b);
  }
  assert.equal(rigs[2].stats.dispose, 1);
}));

test('A late vehicle inherits facade layers and current night lighting, redraws while paused, and restores its original emissive by day', async () => withDom(async () => {
  const tickets = [];
  const harness = facadeHarness(() => { const ticket = deferred(); tickets.push(ticket); return ticket.promise; });
  const building = facadeBuilding('night-building'); harness.scene.add(building);
  const initial = fakeRig('night-stale'), rig = fakeRig('night-ready');
  try {
    harness.game.setFacade(building); harness.game.start(); harness.game.setPaused(true); harness.game.setLighting(.75);
    await flushJobs(); assert.equal(tickets.length, 2);
    tickets[0].resolve(initial); await flushJobs();
    assert.equal(initial.stats.dispose, 1);
    assert.equal(harness.game.update(1000), false, 'A paused facade does not rely on an active animation loop');
    const rendersBefore = harness.stats.renders, geometryBefore = harness.stats.geometry;
    tickets[1].resolve(rig); await flushJobs();
    assert.equal(harness.game.active, true); assert.equal(harness.game.paused, true);
    assert.ok(harness.stats.renders > rendersBefore, 'Async readiness requests a draw even while paused');
    assert.ok(harness.stats.geometry > geometryBefore, 'The facade notices replacement geometry');
    [rig.body, ...rig.rotors].forEach(root => root.traverse(object => assert.equal(object.layers.mask, 1 << 1)));
    assert.ok(harness.camera.layers.isEnabled(1));
    const expectedNight = rig.originalEmissive.clone().multiplyScalar(rig.originalIntensity)
      .add(rig.paint.color.clone().multiplyScalar(.75 * .018));
    close(rig.paint.emissive.r, expectedNight.r, 'The late material inherits red night response');
    close(rig.paint.emissive.g, expectedNight.g, 'The late material inherits green night response');
    close(rig.paint.emissive.b, expectedNight.b, 'The late material inherits blue night response');
    close(rig.paint.emissiveIntensity, 1, 'Night lighting uses its expected scale');
    harness.game.setLighting(0);
    close(rig.paint.emissive.r, rig.originalEmissive.r, 'Day restores original red emissive');
    close(rig.paint.emissive.g, rig.originalEmissive.g, 'Day restores original green emissive');
    close(rig.paint.emissive.b, rig.originalEmissive.b, 'Day restores original blue emissive');
    close(rig.paint.emissiveIntensity, rig.originalIntensity, 'Day restores the original emissive intensity');
    assert.deepEqual(harness.stats.errors, []);
  } finally { harness.game.dispose(); disposeBuilding(building); }
  assert.equal(rig.stats.dispose, 1);
}));
