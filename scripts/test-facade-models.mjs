import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';

function load(name, dependencies = {}) {
  const source = fs.readFileSync(new URL('../src/lib/' + name + '.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, id => {
    assert.ok(id in dependencies, 'Unknown facade dependency: ' + id);
    return dependencies[id];
  });
  return exports;
}

const facade = load('signFacade');
const scene = load('signFacade3D', { three: THREE, './signFacade': facade });
const places = facade.SIGN_PLACEMENTS.filter(place => place.id !== 'none');
const dimensions = [[1800, 300], [5000, 300], [1200, 800]];

function dispose(model) {
  const geometries = new Set(), materials = new Set();
  model.traverse(child => { if (child.geometry) geometries.add(child.geometry); if (child.material) materials.add(child.material); });
  geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
}

test('Every facade palette has the same valid architectural composition in 2D and 3D', () => {
  assert.equal(scene.createFacadeModel('none', 1800, 300).children.length, 0);
  for (const { id: palette } of facade.FACADE_PALETTES) for (const place of places) for (const night of [false, true]) {
    const rects = facade.facadeRects(place.id, night, { palette });
    const svg = facade.createFacadeSvg(place.id, '<svg viewBox="0 0 300 76"><path id="sign" d="M0 0H300V76H0Z"/></svg>', night, 'audit-' + palette + '-' + place.id, { palette });
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
    assert.match(svg, /viewBox="0 0 500 280"/);
    assert.match(svg, /<svg x="75" y="40" width="350" height="90"/);
    assert.match(svg, new RegExp('id="audit-' + palette + '-' + place.id + '-sign"'));
    assert.ok(rects.some(r => r.kind === 'foliage'), 'Planting must be present');
    assert.ok(rects.some(r => r.kind === 'lamp'), 'Architectural lamps must be present');
    if (['shop', 'entrance'].includes(place.id)) assert.ok(rects.some(r => r.name === 'entrance-step'), 'The door must have a threshold and step');
    const model = scene.createFacadeModel(place.id, 1800, 300, { palette });
    assert.equal(model.children.length, rects.length);
    assert.ok(model.getObjectByName('facade-wall').receiveShadow);
    dispose(model);
  }
});

test('Windows have real apertures and separate glazing and frames at every facade size', () => {
  for (const { id: palette } of facade.FACADE_PALETTES) for (const place of places) for (const [width, height] of dimensions) {
    const scale = Math.max(width / 300, height / 76, 8);
    const rects = facade.facadeRects(place.id, false, { palette });
    const model = scene.createFacadeModel(place.id, width, height, { palette, signBackMm: 50 });
    model.updateMatrixWorld(true);
    const wall = model.getObjectByName('facade-wall');
    const positions = wall.geometry.getAttribute('position'), depth = wall.geometry.parameters.options.depth * scale;
    let faceArea = 0;
    for (let index = 0; index < positions.count; index += 3) {
      if (![0, 1, 2].every(offset => Math.abs(positions.getZ(index + offset) - depth) < .005)) continue;
      const a = new THREE.Vector3().fromBufferAttribute(positions, index);
      const b = new THREE.Vector3().fromBufferAttribute(positions, index + 1);
      const c = new THREE.Vector3().fromBufferAttribute(positions, index + 2);
      faceArea += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    const openings = rects.filter(r => r.kind === 'opening');
    const expectedArea = (500 * 273 - openings.reduce((sum, r) => sum + r.w * r.h, 0)) * scale ** 2;
    assert.ok(Math.abs(faceArea - expectedArea) < expectedArea * .000001, 'Wall triangles must not fill the glazing apertures');
    for (const glass of rects.filter(r => r.kind === 'glass')) {
      const ray = new THREE.Raycaster(new THREE.Vector3((glass.x + glass.w * .3 - 250) * scale,
        (85 - glass.y - glass.h * .25) * scale, 5000), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObjects(model.children, false)[0];
      assert.equal(hit?.object.userData.facadeKind, 'glass', place.id + ': glazing must be visible through the wall');
      assert.ok(hit.object.material.roughness >= .4 && hit.object.material.envMapIntensity <= .2, 'Window reflections must remain restrained');
      assert.ok(hit.object.material.userData.facadeEmission, 'Interior light is independent of the sign switch');
      const frame = model.children.find(child => child.name === hit.object.name.replace('-glass', '-frame'));
      assert.ok(frame && frame.userData.frontZ > hit.object.userData.frontZ + .5 * scale, 'Glazing and frame front surfaces must not be coplanar');
    }
    for (const mesh of model.children) {
      const attr = mesh.geometry.getAttribute('position');
      for (let index = 0; index < attr.array.length; index++) assert.ok(Number.isFinite(attr.array[index]));
      assert.ok(mesh.position.toArray().every(Number.isFinite) && mesh.scale.toArray().every(Number.isFinite));
    }
    dispose(model);
  }
});

test('The sign is mounted on the canopy fascia and the roof cannot occlude its slot', () => {
  for (const { id: palette } of facade.FACADE_PALETTES) for (const [width, height] of dimensions) {
    const scale = Math.max(width / 300, height / 76, 8);
    const model = scene.createFacadeModel('canopy', width, height, { palette, signBackMm: 100 });
    model.updateMatrixWorld(true);
    for (const [x, y] of [[250, 85], [100, 50], [400, 120]]) {
      const hit = new THREE.Raycaster(new THREE.Vector3((x - 250) * scale, (85 - y) * scale, 5000), new THREE.Vector3(0, 0, -1))
        .intersectObjects(model.children, false)[0];
      assert.equal(hit?.object.name, 'facade-canopy-fascia');
    }
    assert.equal(model.getObjectByName('facade-canopy-fascia').userData.frontZ, -104, 'Fascia must stay behind the actual back of the sign');
    dispose(model);
  }
});
