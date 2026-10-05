import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as THREE from "three";
const require = createRequire(import.meta.url);
function load(name, dependencies = {}) {
  const source = fs.readFileSync(new URL('../src/lib/' + name + '.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, key => dependencies[key] ?? require(key));
  return exports;
}
const mount = load('panelConstruction');
const svg = load('signPanelExport', { './panelConstruction': mount });
const scene = load('signSceneGeometry', { three: THREE, './panelConstruction': mount, './letterContours': {} });
for (const shape of ['circle','square','rounded']) test(shape + ': две консоли, отдельные пластины и корпус заданной глубины', async () => {
  for (const size of [200, 500, 2000]) for (const gap of [60, 120, 400]) {
    const project = { productId: 'panel', panelShape: shape, panelSize: size, panelWallGap: gap, panelCornerRadius: 90,
      sceneMode: 'day', panelFaceColor: {value:'#ffffff'}, panelSideColor: {value:'#172333'}, panelImage: '' };
    const model = await scene.buildSignModel(project, {}, size, size, 100, false);
    assert.equal(model.children.filter(item => item.name === 'bracket-arm').length, 2);
    assert.equal(model.children.filter(item => item.name === 'wall-mount-plate').length, 2);
    assert.equal(model.children.filter(item => item.name === 'wall-anchor').length, 4);
    assert.equal(model.children.filter(item => item.name === 'panel-rim').length, 2);
    const body = model.getObjectByName('panel-body');
    body.geometry.computeBoundingBox();
    assert.equal(body.geometry.boundingBox.max.z - body.geometry.boundingBox.min.z, 100);
    assert.equal(body.material[0], body.material[2], 'Общее лицевое покрытие с двух сторон');
    const wallX = -size / 2 - gap;
    for (const plate of model.children.filter(item => item.name === 'wall-mount-plate')) {
      const box = new THREE.Box3().setFromObject(plate);
      assert.equal(box.min.x, wallX, 'Пластина непосредственно касается стены');
    }
    for (const arm of model.children.filter(item => item.name === 'bracket-arm')) {
      const box = new THREE.Box3().setFromObject(arm);
      assert.ok(Math.abs(box.min.x - wallX - 5) < 0.001);
      assert.ok(box.max.x > -size / 2, 'Консоль входит в корпус');
    }
    const markup = svg.createPanelSvgMarkup({ shape, size, wallGap: gap, cornerRadius: 90, depth: 100,
      faceColor: '#fff', sideColor: '#172333', image: '', imageScale: 82, imageX: 0, imageY: 0, showDimensions: true });
    assert.equal((markup.match(/data-bracket-arm/g) ?? []).length, 2);
    assert.ok(markup.includes(gap + ' мм'));
    assert.doesNotMatch(markup, /NaN|Infinity|undefined/);
    scene.disposeSignObject(model);
  }
});
test('Скругление ограничено половиной стороны и не меняет наружный размер', () => {
  assert.equal(mount.panelConstruction(200,'rounded',120,300).radius, 100);
  assert.equal(mount.panelConstruction(500,'square',120,90).radius, 0);
});
