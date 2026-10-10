import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const source = fs.readFileSync(new URL('../src/' + path + '.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}; cache.set(path, exports);
  new Function('exports', 'require', code)(exports, id => id === 'three' ? THREE : load(path.slice(0, path.lastIndexOf('/') + 1) + id.slice(2)));
  return exports;
}
const { initialRenderTier, createQualityGovernor, QUALITY, resizeShadow } = load('rc-game/renderQuality');
const { createFacadeModel } = load('lib/signFacade3D');

test('Device profiles cap raster and shadow work without assuming screen width is hardware power', () => {
  assert.equal(initialRenderTier({ coarse: false, cores: 12, memory: 16 }), 'high');
  assert.equal(initialRenderTier({ coarse: true, cores: 8 }), 'balanced');
  assert.equal(initialRenderTier({ coarse: false, memory: 4 }), 'low');
  assert.ok(QUALITY.low.dpr <= 1 && QUALITY.low.shadow <= 1024);
});
test('Quality adapts to sustained slow frames, ignoring loading gaps and brief spikes', () => {
  const governor = createQualityGovernor('high');
  for (let i = 0; i < 1000; i++) governor.sample(16.7);
  assert.equal(governor.tier, 'high');
  governor.sample(5000); governor.sample(90);
  assert.equal(governor.tier, 'high');
  for (let i = 0; i < 160; i++) governor.sample(33.3);
  assert.equal(governor.tier, 'balanced');
  governor.reset();
  for (let i = 0; i < 160; i++) governor.sample(33.3);
  assert.equal(governor.tier, 'low');
  for (let i = 0; i < 1000; i++) governor.sample(16.7);
  assert.equal(governor.tier, 'low', 'No oscillation during the current session');
});
test('Changing shadow resolution releases the old GPU target', () => {
  const light = new THREE.DirectionalLight(); light.shadow.mapSize.set(2048, 2048);
  const map = new THREE.WebGLRenderTarget(2048, 2048); let disposed = false;
  map.addEventListener('dispose', () => { disposed = true; }); light.shadow.map = map;
  resizeShadow(light, 1024); assert.ok(disposed); assert.equal(light.shadow.map, null);
  assert.equal(light.shadow.mapSize.x, 1024); assert.ok(light.shadow.needsUpdate);
});
test('Facade batches preserve instance positions, named collision anchors and independent windows', () => {
  for (const placement of ['windows', 'shop', 'canopy', 'entrance']) {
    const model = createFacadeModel(placement, 2000, 400);
    const batches = model.children.filter(mesh => mesh.isInstancedMesh);
    const originals = model.children.filter(mesh => mesh.userData.batched);
    assert.ok(batches.length > 0); assert.ok(model.userData.savedDrawCalls > 20);
    assert.equal(originals.length, batches.reduce((n, mesh) => n + mesh.count, 0));
    const before = new THREE.Box3(); originals.forEach(mesh => before.union(new THREE.Box3().setFromObject(mesh)));
    const after = new THREE.Box3(); batches.forEach(mesh => after.union(new THREE.Box3().setFromObject(mesh)));
    assert.ok(before.min.distanceTo(after.min) < .01 && before.max.distanceTo(after.max) < .01);
    assert.ok(model.getObjectByName('facade-pavement').visible);
    const panes = model.children.filter(mesh => mesh.userData.facadeKind === 'glass');
    assert.equal(new Set(panes.map(mesh => mesh.material)).size, panes.length);
    assert.ok(panes.every(mesh => mesh.visible));
    console.log(placement, 'saved opaque draws', model.userData.savedDrawCalls);
  }
});
test('Both shipped LODs retain the body, four separate rotors, normals and physical envelope', async () => {
  const info = JSON.parse(fs.readFileSync('public/models/ram-trx-info.json', 'utf8'));
  for (const [name, budget] of [['mobile', 30000], ['far', 15000]]) {
    const bytes = fs.readFileSync(`public/models/ram-trx-${name}.glb`);
    const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    for (const name of ['BODY', ...info.wheelNames]) assert.ok(scene.getObjectByName(name));
    let triangles = 0;
    scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      const g = mesh.geometry, p = g.attributes.position;
      triangles += g.index.count / 3;
      assert.ok(Array.from(p.array).every(Number.isFinite));
      assert.ok(Array.from(g.index.array).every(i => i < p.count));
      assert.equal(g.attributes.normal.count, p.count);
    });
    assert.ok(triangles <= budget && triangles > 5000);
    const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3()).toArray();
    size.forEach((v, i) => assert.ok(Math.abs(v - info.dimensions[i]) < .025));
  }
});
