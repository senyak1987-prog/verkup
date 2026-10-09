import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';

const source = fs.readFileSync(new URL('../src/rc-game/trxSuspension.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
} }).outputText;
const api = {};
new Function('exports', 'require', code)(api, id => {
  assert.equal(id, 'three'); return THREE;
});
const profileApi = {};
new Function('exports', ts.transpileModule(
  fs.readFileSync(new URL('../src/rc-game/trxAssetProfile.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText)(profileApi);
const { TRX_VEHICLE_PROFILE } = profileApi;
const materials = Object.fromEntries(['dark', 'silver', 'spring'].map(name => [name, new THREE.MeshStandardMaterial()]));
const wheels = () => [-1, 1, -1, 1].map((side, i) => ({
  x: side * .58, z: i < 2 ? .44 : -.44, height: -.29, compression: 0,
}));
const end = (mesh, sign) => new THREE.Vector3(0, sign * .5, 0).applyMatrix4(mesh.matrix);
const worldEnd = (mesh, sign) => new THREE.Vector3(0, sign * .5, 0).applyMatrix4(mesh.matrixWorld);

test('Damper shafts telescope and springs compress while rigid housings retain their length', () => {
  const suspension = api.createTrxSuspension(new THREE.Group(), materials), state = wheels();
  suspension.update(state);
  const assembly = suspension.root.getObjectByName('rc-trx-damper-0');
  const body = assembly.getObjectByName('rc-trx-damper-body');
  const shaft = assembly.getObjectByName('rc-trx-sliding-piston');
  const coil = assembly.getObjectByName('rc-trx-coil-spring');
  const rest = { body: body.scale.y, shaft: shaft.scale.y, coil: coil.scale.y };
  state[0].height += .12; suspension.update(state);
  assert.equal(body.scale.y, rest.body);
  assert.ok(shaft.scale.y < rest.shaft - .09);
  assert.ok(coil.scale.y < rest.coil - .09);
  state[0].height -= .23; suspension.update(state);
  assert.equal(body.scale.y, rest.body);
  assert.ok(shaft.scale.y > rest.shaft + .09);
  assert.ok(coil.scale.y > rest.coil + .09);
});

test('Rear axle follows both wheel hubs across asymmetric travel and remains connected', () => {
  const suspension = api.createTrxSuspension(new THREE.Group(), materials), state = wheels();
  state[2].height += .13; state[3].height -= .10;
  suspension.update(state); suspension.root.updateMatrixWorld(true);
  const axle = suspension.root.getObjectByName('rc-trx-rear-solid-axle');
  assert.ok(end(axle, -1).distanceTo(new THREE.Vector3(state[2].x, state[2].height, state[2].z)) < 1e-8);
  assert.ok(end(axle, 1).distanceTo(new THREE.Vector3(state[3].x, state[3].height, state[3].z)) < 1e-8);
});

test('The downloaded rig keeps both damper mounts connected throughout its real wheel travel', () => {
  const profile = TRX_VEHICLE_PROFILE;
  const restHeight = profile.wheelRadius - profile.bodyRestHeight;
  const size = profile.wheelRadius / .19;
  const state = [-1, 1, -1, 1].map((side, i) => ({
    x: side * (i < 2 ? profile.frontTrackWidth : profile.rearTrackWidth) / 2,
    z: (i < 2 ? 1 : -1) * profile.wheelBase / 2, height: restHeight, compression: 0,
  }));
  const suspension = api.createTrxSuspension(new THREE.Group(), materials, profile);
  const assemblies = state.map((_, index) => suspension.root.getObjectByName(`rc-trx-damper-${index}`));
  const bodyLengths = assemblies.map(assembly => assembly.getObjectByName('rc-trx-damper-body').scale.y);
  for (const travel of [[-.12, -.12, -.12, -.12], [0, 0, 0, 0], [.14, .14, .14, .14], [.14, -.12, -.09, .13]]) {
    state.forEach((wheel, index) => { wheel.height = restHeight + travel[index]; });
    suspension.update(state); suspension.root.updateMatrixWorld(true);
    state.forEach((wheel, index) => {
      const side = Math.sign(wheel.x), assembly = assemblies[index];
      const body = assembly.getObjectByName('rc-trx-damper-body');
      const shaft = assembly.getObjectByName('rc-trx-sliding-piston');
      const coil = assembly.getObjectByName('rc-trx-coil-spring');
      const upper = new THREE.Vector3(wheel.x - side * .085 * size, profile.mountY, wheel.z);
      const lower = new THREE.Vector3(wheel.x - side * .025 * size, wheel.height + .025 * size, wheel.z);
      assert.ok(worldEnd(body, 1).distanceTo(upper) < 1e-8, 'The rigid housing stays attached to its chassis mount');
      assert.ok(worldEnd(shaft, -1).distanceTo(lower) < 1e-8, 'The shaft stays attached to the moving wheel mount');
      assert.ok(worldEnd(body, -1).distanceTo(worldEnd(shaft, 1)) < 1e-8, 'The shaft slides into the housing without a gap');
      assert.equal(body.scale.y, bodyLengths[index]);
      assert.ok(shaft.scale.y > 0 && coil.scale.y > 0, 'Full bump must not invert a shock component');
      assert.ok(body.scale.y < upper.distanceTo(lower), 'The housing must fit inside the fully compressed damper');
    });
  }
});

test('Repeated full suspension travel updates existing GPU objects without invalid transforms', () => {
  const suspension = api.createTrxSuspension(new THREE.Group(), materials), state = wheels();
  const objects = []; suspension.root.traverse(object => objects.push(object));
  const geometries = new Set(objects.map(object => object.geometry).filter(Boolean));
  for (let tick = 0; tick < 2000; tick++) {
    state.forEach((wheel, i) => { wheel.height = -.29 + Math.sin(tick * .07 + i) * .14; });
    suspension.update(state);
    for (const object of objects) {
      assert.ok([...object.position, ...object.scale, ...object.quaternion].every(Number.isFinite));
      if (object.isMesh) assert.ok(object.scale.y > 0);
    }
  }
  const final = []; suspension.root.traverse(object => final.push(object));
  assert.deepEqual(final, objects);
  assert.deepEqual(new Set(final.map(object => object.geometry).filter(Boolean)), geometries);
});
