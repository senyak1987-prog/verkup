import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
function load(name, dependencies = {}) {
  const source = fs.readFileSync(new URL('../src/lib/' + name + '.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, key => dependencies[key] ?? require(key));
  return exports;
}
const daylight = load('signDaylight');
const mounting = load('panelConstruction');
const shapes = load('glyphShapes', { three: THREE, libtess: { default: require('libtess') } });
const geometry = load('signSceneGeometry', {
  three: THREE, './panelConstruction': mounting, './glyphShapes': shapes, './letterContours': {}, './neonScene': {},
  // This material test does not parse typography; contour geometry has its own browser/font tests.
  'three/examples/jsm/loaders/SVGLoader.js': { SVGLoader: class { parse() { return { paths: [] }; } } },
});

test('Dimension overlays invert the surface without daylight tint or opaque texture rectangles', async () => {
  const previousDocument = globalThis.document, inks = [];
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    measureText: text => ({ width: text.length * 24 }),
    fillText() { inks.push(this.fillStyle); },
  }) }) };
  let model;
  try {
    model = await geometry.buildSignModel({
      productId: 'panel', panelShape: 'circle', panelSize: 550, panelWallGap: 120,
      sceneMode: 'day', panelFaceColor: { value: '#280b57' }, panelSideColor: { value: '#25364b' }, panelImage: '',
    }, {}, 550, 550, 160, true);
    const dimensions = model.getObjectByName('dimensions');
    assert.ok(dimensions.children.some(child => child instanceof THREE.Sprite));
    assert.ok(dimensions.children.some(child => child instanceof THREE.LineSegments));
    for (const night of [0, .5, 1, 0]) {
      geometry.applySignLighting(model, night, true);
      for (const child of dimensions.children) {
        const material = child.material;
        assert.equal(material.color.getHexString(), 'ffffff', 'Lighting cannot darken the inverse-colour source');
        assert.equal(material.blending, THREE.CustomBlending);
        assert.equal(material.blendSrc, THREE.OneMinusDstColorFactor);
        assert.equal(material.blendDst, THREE.OneMinusSrcAlphaFactor);
        assert.equal(material.premultipliedAlpha, true, 'Transparent atlas pixels preserve the existing background');
        assert.equal(material.depthWrite, false);
        assert.equal(material.toneMapped, false);
        assert.ok(child.renderOrder >= 1000, 'Measurements are composited after the physical surfaces');
      }
    }
    assert.ok(inks.length > 0 && inks.every(ink => ink === '#ffffff'));
  } finally {
    if (model) geometry.disposeSignObject(model);
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('Millimetre point daylight keeps the same irradiance across sign sizes and marker positions', () => {
  const center = { x: 125, y: -640, z: 80 };
  for (const span of [100, 550, 1200, 7800]) for (const marker of [{ x: .18, y: .2 }, { x: .5, y: .5 }, { x: .94, y: .06 }]) {
    const source = daylight.daylightSource({ center, span }, marker);
    const light = new THREE.PointLight('#ffffff', source.intensity, 0, 2);
    light.position.set(source.position.x, source.position.y, source.position.z);
    const distance = light.position.distanceTo(new THREE.Vector3(center.x, center.y, center.z));
    assert.ok(Math.abs(light.intensity / distance ** light.decay - daylight.DAYLIGHT_LEVELS.targetIrradiance) < 1e-12,
      'Moving or resizing the model must not brighten its paint through an unscaled point light');
    assert.equal(light.distance, 0, 'No abrupt distance cutoff across the scene');
    assert.ok(source.shadowNear > 0 && source.shadowNear < distance);
    assert.ok(source.shadowFar > distance + span * 2, 'The model and its receiving architecture remain in the shadow frustum');
  }
  assert.ok(daylight.DAYLIGHT_LEVELS.ambient <= .2 && daylight.DAYLIGHT_LEVELS.environment <= .3 && daylight.DAYLIGHT_LEVELS.fill <= .1,
    'Ambient fill must leave contrast for the explicit daylight source');
});

test('Daylight markers clamp to the preview edges and malformed bounds cannot create infinite light', () => {
  const center = { x: 0, y: 0, z: 0 };
  const low = daylight.daylightSource({ center, span: 600 }, { x: -5, y: 7 });
  const edge = daylight.daylightSource({ center, span: 600 }, { x: .06, y: .94 });
  assert.deepEqual(low, edge);
  const invalid = daylight.daylightSource({ center: { x: NaN, y: Infinity, z: 0 }, span: NaN }, { x: NaN, y: Infinity });
  assert.ok(Object.values(invalid.position).every(Number.isFinite));
  assert.ok(Number.isFinite(invalid.intensity) && invalid.intensity > 0);
  assert.deepEqual(invalid, daylight.daylightSource({ center, span: 100 }));
});

test('Daytime LED faces retain pigment and visible emission while night output and switch remain intact', async () => {
  const model = await geometry.buildSignModel({
    productId: 'panel', panelShape: 'circle', panelSize: 550, panelWallGap: 120,
    sceneMode: 'night', panelFaceColor: { value: '#1681d9' }, panelSideColor: { value: '#25364b' }, panelImage: '',
  }, {}, 550, 550, 160, false);
  try {
    const face = model.getObjectByName('panel-body').material[0];
    geometry.applySignLighting(model, 0, true);
    assert.equal(face.color.getHexString(), '1681d9', 'The chosen sRGB pigment survives the Linear working colour space');
    assert.ok(face.emissiveIntensity >= .2 && face.emissiveIntensity < .5,
      'Daytime LEDs remain visibly lit below night output without changing the selected pigment');
    geometry.applySignLighting(model, 1, true);
    assert.equal(face.emissiveIntensity, 1.4, 'Full night brightness remains unchanged');
    geometry.applySignLighting(model, 0, false);
    assert.equal(face.emissiveIntensity, 0);
    geometry.applySignLighting(model, 1, false);
    assert.equal(face.emissiveIntensity, 0);
  } finally { geometry.disposeSignObject(model); }
});

test('Red ACP paint stays non-emissive and preserves the selected sRGB colour in daylight', async () => {
  const model = await geometry.buildSignModel({
    productId: 'letters', sceneMode: 'day', lettersText: 'А', letterFont: 'Manrope', letterHeight: 100,
    letterDepth: 50, letterFaceColor: { value: '#1681d9' }, letterSideColor: { value: '#25364b' }, glowMode: 'face',
    mountMode: 'acp', acpDepth: 60, acpColor: { value: '#e61a20' }, logoEnabled: false,
  }, {
    panelBox: { x: 0, y: 0, width: 400, height: 200 }, panelCornerRadius: 0,
    signBox: { x: 50, y: 50, width: 200, height: 100 }, logoBox: { x: 0, y: 0, width: 0, height: 0 },
    textX: 50, textBaseline: 150, textWidth: 200, textHeight: 100,
    textPathData: 'M0 0H100V100H0Z', textNaturalBox: { x: 0, y: 0, width: 100, height: 100 },
  }, 400, 200, 50, false);
  try {
    geometry.applySignLighting(model, 0, true);
    for (const material of model.getObjectByName('acp-box').material) {
      assert.equal(material.color.getHexString(), 'e61a20');
      assert.equal(material.emissiveIntensity, 0, 'The red backing is paint, not a self-luminous colour wash');
    }
  } finally { geometry.disposeSignObject(model); }
});

test('Weak day emission does not change neon output or the independent delayed window phase', () => {
  const window = new THREE.MeshStandardMaterial({ color: '#526d7b', emissive: '#ffd8a1' });
  Object.assign(window.userData, { windowLight: true, windowIndex: 3, maxWindowEmission: .5, facadeEmission: true });
  const neon = new THREE.MeshStandardMaterial({ color: '#ff55aa', emissive: '#ff55aa' });
  neon.userData.neonEmission = 1.8;
  const group = new THREE.Group();
  for (const material of [window, neon]) group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
  try {
    geometry.applySignLighting(group, 0, true, 0);
    assert.ok(Math.abs(neon.emissiveIntensity - .63) < 1e-12);
    assert.equal(window.emissiveIntensity, 0);
    geometry.applySignLighting(group, 1, false, 1);
    assert.equal(neon.emissiveIntensity, 0);
    assert.equal(window.emissiveIntensity, .5);
    geometry.applySignLighting(group, 1, true, 0);
    assert.equal(neon.emissiveIntensity, 1.8);
    assert.equal(window.emissiveIntensity, 0, 'Night and the later window illumination phase remain independent');
  } finally { geometry.disposeSignObject(group); }
});

test('Daytime halo remains visible, fades continuously into night, and switches fully off', () => {
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: .8 });
  material.userData.lightOpacity = .8;
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
  try {
    geometry.applySignLighting(group, 0, true); const day = material.opacity;
    geometry.applySignLighting(group, .5, true); const dusk = material.opacity;
    geometry.applySignLighting(group, 1, true); const night = material.opacity;
    assert.ok(day > .1 && day < dusk && dusk < night);
    assert.equal(night, .8);
    for (const fraction of [0, .5, 1]) { geometry.applySignLighting(group, fraction, false); assert.equal(material.opacity, 0); }
  } finally { geometry.disposeSignObject(group); }
});