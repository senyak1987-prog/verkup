import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Exercise the shipped GLB and the production loader, including real surface
// projection. Only transfer and canvas drawing are replaced; no network/GPU is used.
const fixture = fs.readFileSync(new URL('../public/models/ram-trx.glb', import.meta.url));
const info = JSON.parse(fs.readFileSync(new URL('../public/models/ram-trx-info.json', import.meta.url), 'utf8'));
function load(name, dependencies = {}) {
  const source = fs.readFileSync(new URL(`../src/rc-game/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, dependency => {
    assert.ok(dependency in dependencies, `Unknown asset test dependency: ${dependency}`);
    return dependencies[dependency];
  });
  return exports;
}
const wordmark = load('brandWordmark');
const truck = load('trxTruck', { three: THREE, './brandWordmark': wordmark,
  'three/examples/jsm/geometries/RoundedBoxGeometry.js': { RoundedBoxGeometry } });
const { createTrxAssetLoader } = load('trxAsset', { three: THREE, './trxTruck': truck,
  'three/examples/jsm/loaders/GLTFLoader.js': { GLTFLoader },
  'three/examples/jsm/geometries/DecalGeometry.js': { DecalGeometry },
  'three/examples/jsm/utils/BufferGeometryUtils.js': { toCreasedNormals } });
const { TRX_VEHICLE_PROFILE } = load('trxAssetProfile');

class CanvasStub {
  width = 0; height = 0;
  context = new Proxy({ measureText: text => ({ width: String(text).length * 8 }) }, {
    get: (target, key) => target[key] ?? (() => {}),
    set: (target, key, value) => { target[key] = value; return true; },
  });
  getContext(kind) { assert.equal(kind, '2d'); return this.context; }
}

async function offline(url, run, response = () => fixture) {
  const names = ['document', 'fetch', 'ProgressEvent'];
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const requests = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(tag) { assert.equal(tag, 'canvas'); return new CanvasStub(); },
  } });
  Object.defineProperty(globalThis, 'ProgressEvent', { configurable: true,
    value: class extends Event { constructor(type, values) { super(type); Object.assign(this, values); } } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async input => {
    const requested = typeof input === 'string' ? input : input.url;
    // An external texture or other accidental request must fail the test rather
    // than silently reaching the internet.
    assert.equal(requested, url, 'The GLB must be self-contained and use the caller-provided URL');
    requests.push(requested);
    const bytes = await response(requests.length);
    return new Response(bytes, { status: 200, headers: {
      'Content-Type': 'model/gltf-binary', 'Content-Length': String(bytes.length),
    } });
  } });
  try { return await run(requests); }
  finally {
    names.forEach((name, index) => {
      if (originals[index]) Object.defineProperty(globalThis, name, originals[index]);
      else delete globalThis[name];
    });
  }
}

function resources(rig) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  for (const root of [rig.body, ...rig.rotors]) root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  return { geometries, materials, textures };
}
function trackDisposal(rig) {
  const owned = resources(rig), counts = new Map();
  for (const set of Object.values(owned)) for (const resource of set) {
    counts.set(resource, 0);
    resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  }
  return { ...owned, counts };
}
function materialsByName(rig) {
  return new Map([...resources(rig).materials].map(material => [material.name, material]));
}
function originalTriangleCount(rig) {
  let total = 0;
  for (const root of [rig.body, ...rig.rotors]) root.traverse(object => {
    if (object.isMesh && !object.name.startsWith('rc-trx-gorod-svet-')) {
      total += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    }
  });
  return total;
}
function close(actual, expected, message, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`);
}

test('The shipped RAM TRX has centered independent rotors, measured dimensions and three projected logos', async () => {
  const url = 'https://trx-asset.invalid/contracts.glb';
  await offline(url, async requests => {
    const rig = await createTrxAssetLoader(url)();
    try {
      assert.equal(requests.length, 1);
      assert.equal(originalTriangleCount(rig), info.triangles);
      assert.deepEqual(rig.rotors.map(rotor => rotor.name), info.wheelRuntimeOrder);
      assert.equal(rig.rotors.length, 4);
      for (const rotor of rig.rotors) {
        assert.deepEqual([...rotor.position], [0, 0, 0], 'The world owns each hub position');
        assert.deepEqual(rotor.quaternion.toArray(), [0, 0, 0, 1]);
        assert.deepEqual([...rotor.scale], [1, 1, 1]);
        const expected = info.wheels.find(wheel => wheel.nodeName === rotor.name).localBounds;
        const bounds = new THREE.Box3().setFromObject(rotor);
        for (let axis = 0; axis < 3; axis++) {
          close(bounds.min.getComponent(axis), expected.min[axis], `${rotor.name} centered minimum`);
          close(bounds.max.getComponent(axis), expected.max[axis], `${rotor.name} centered maximum`);
        }
      }
      const bounds = new THREE.Box3().setFromObject(rig.body);
      for (let axis = 0; axis < 3; axis++) {
        close(bounds.min.getComponent(axis), info.bodyBounds.min[axis], 'The normalized body minimum');
        close(bounds.max.getComponent(axis), info.bodyBounds.max[axis], 'The normalized body maximum');
      }
      const scale = TRX_VEHICLE_PROFILE.modelScale ?? 1;
      close(TRX_VEHICLE_PROFILE.halfWidth, Math.max(-bounds.min.x, bounds.max.x) * scale, 'Playable collision half width');
      close(TRX_VEHICLE_PROFILE.halfLength, Math.max(-bounds.min.z, bounds.max.z) * scale, 'Playable collision half length');
      close(TRX_VEHICLE_PROFILE.halfHeight * 2, (bounds.max.y - bounds.min.y) * scale, 'Playable collision height');
      close(TRX_VEHICLE_PROFILE.centerOffset, (bounds.max.y + bounds.min.y) / 2 * scale, 'Playable collision centre height');
      assert.equal(rig.body.userData.liveryCount, 3);
      for (const position of ['door-negative-x', 'door-positive-x', 'hood']) {
        const label = rig.body.getObjectByName(`rc-trx-gorod-svet-${position}`);
        assert.ok(label?.children.length, `The ${position} projection must hit real body geometry`);
        label.children.forEach(mesh => assert.ok(mesh.geometry.attributes.position.count > 0));
      }
      const materials = materialsByName(rig);
      assert.equal(materials.get('x3_null__PAINT_1').color.getHexString(), 'e8bc45');
      assert.equal(materials.get('x3_null__PAINT_2').color.getHexString(), '173e31');
      assert.ok(materials.get('x3_wheel').roughness > .85, 'Tyres retain their rubber finish');
      assert.equal(rig.body.userData.author, info.author);
      assert.equal(rig.body.userData.license, info.license);
    } finally { rig.dispose(); }
  });
});

test('Concurrent and later rigs share one transfer while paint and disposable resources remain independent', async () => {
  const url = 'https://trx-asset.invalid/independent.glb';
  await offline(url, async requests => {
    const factory = createTrxAssetLoader(url), rigs = await Promise.all([factory(), factory()]);
    const [first, second] = rigs;
    try {
      assert.equal(requests.length, 1, 'Concurrent instantiation shares the template transfer');
      const a = trackDisposal(first), b = trackDisposal(second);
      for (const key of ['geometries', 'materials', 'textures']) {
        assert.ok(a[key].size > 0);
        for (const resource of a[key]) assert.ok(!b[key].has(resource), `${key} must belong to only one rig`);
      }
      const firstMaterials = materialsByName(first), secondMaterials = materialsByName(second);
      const unchanged = new Map([...firstMaterials.values()].filter(material => material.name !== 'x3_null__PAINT_1')
        .map(material => [material, material.color.getHexString()]));
      first.setColor('#ff0044');
      assert.equal(firstMaterials.get('x3_null__PAINT_1').color.getHexString(), 'ff0044');
      assert.equal(secondMaterials.get('x3_null__PAINT_1').color.getHexString(), 'e8bc45');
      for (const [material, color] of unchanged) assert.equal(material.color.getHexString(), color, 'Trim, glass, tyres and livery keep their colors');
      for (const invalid of ['red', '#fff', '#gggggg']) first.setColor(invalid);
      assert.equal(firstMaterials.get('x3_null__PAINT_1').color.getHexString(), 'ff0044');
      const parent = new THREE.Group(); parent.add(first.body, ...first.rotors);
      first.dispose(); first.dispose();
      assert.equal(parent.children.length, 0, 'Disposal detaches every independently mounted part');
      for (const count of a.counts.values()) assert.equal(count, 1, 'Owned resources are released exactly once');
      for (const count of b.counts.values()) assert.equal(count, 0, 'Another live rig is unaffected');
      const third = await factory(); rigs.push(third);
      assert.equal(requests.length, 1, 'Disposing instances leaves the original template reusable');
      assert.equal(originalTriangleCount(third), info.triangles);
      assert.equal(third.body.userData.liveryCount, 3);
      second.dispose();
      for (const count of b.counts.values()) assert.equal(count, 1);
    } finally { rigs.forEach(rig => rig.dispose()); }
  });
});

test('Repaired paint has outward coherent normals, opaque depth-tested lenses and the official vector wordmark', async () => {
  const url='https://trx-asset.invalid/repaired.glb';
  await offline(url,async()=>{
    const rig=await createTrxAssetLoader(url)();
    try {
      const materials=materialsByName(rig);
      assert.ok(materials.get('x3_null__PAINT_1').roughness>=.3);
      assert.equal(materials.get('preded_steklo_far').transparent,false,'Headlamp shells must not produce alpha-sorting holes');
      const logo=materials.get('rc-official-gorod-svet-wordmark');
      assert.equal(logo.userData.source,'public/gorod-svet-wordmark.svg');
      assert.equal(logo.transparent,false);assert.equal(logo.depthWrite,true);assert.ok(logo.alphaTest>0);
      let triangles=0;
      rig.body.traverse(mesh=>{
        if(!mesh.isMesh||mesh.material.name!=='x3_null__PAINT_1')return;
        const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
        const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
        for(let i=0;i<p.count;i+=3){
          a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1).sub(a);c.fromBufferAttribute(p,i+2).sub(a);
          normal.set(n.getX(i)+n.getX(i+1)+n.getX(i+2),n.getY(i)+n.getY(i+1)+n.getY(i+2),n.getZ(i)+n.getZ(i+1)+n.getZ(i+2));
          assert.ok(b.cross(c).dot(normal)>=-1e-12,'A paint triangle must not face against its shading normal');triangles++;
        }
      });
      assert.ok(triangles>4000,'The check must exercise the real body mesh');
    } finally {rig.dispose();}
  });
});

test('A failed transfer is rejected and the same loader retries instead of retaining a rejected cache entry', async () => {
  const url = 'https://trx-asset.invalid/retry.glb';
  await offline(url, async requests => {
    const factory = createTrxAssetLoader(url);
    await assert.rejects(factory(), /Controlled fixture transfer failure/);
    const rig = await factory();
    try { assert.equal(requests.length, 2); assert.equal(originalTriangleCount(rig), info.triangles); }
    finally { rig.dispose(); }
  }, attempt => {
    if (attempt === 1) throw new Error('Controlled fixture transfer failure');
    return fixture;
  });
});

test('A malformed prepared hierarchy is rejected and can be replaced by a valid GLB on retry', async () => {
  const malformed = Buffer.from(fixture), chunkLength = malformed.readUInt32LE(12);
  const manifest = JSON.parse(malformed.subarray(20, 20 + chunkLength).toString('utf8'));
  manifest.nodes.find(node => node.name === 'BODY').name = 'NOPE';
  const encoded = Buffer.from(JSON.stringify(manifest));
  assert.ok(encoded.length <= chunkLength);
  malformed.fill(0x20, 20, 20 + chunkLength); encoded.copy(malformed, 20);
  const url = 'https://trx-asset.invalid/hierarchy-retry.glb';
  await offline(url, async requests => {
    const factory = createTrxAssetLoader(url);
    await assert.rejects(factory(), /no prepared body or four independent wheel rotors/);
    const rig = await factory();
    try { assert.equal(requests.length, 2); assert.equal(rig.rotors.length, 4); }
    finally { rig.dispose(); }
  }, attempt => attempt === 1 ? malformed : fixture);
});
