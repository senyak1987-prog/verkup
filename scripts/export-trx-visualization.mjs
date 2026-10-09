/** Export the game's actual paint and projected livery as standalone assets.
 * Usage: node scripts/export-trx-visualization.mjs [--canvas-module=MODULE]
 * Native canvas is read from the bundled Codex runtime; no project install is needed.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(project, '../3d-models/ram-trx-downloaded/prepared');
const stem = 'ram-trx-gorod-svet', logoFile = `${stem}-logo.png`, alphaFile = `${stem}-logo-alpha.png`;
const source = await readFile(path.join(project, 'public/models/ram-trx.glb'));
const info = JSON.parse(await readFile(path.join(project, 'public/models/ram-trx-info.json'), 'utf8'));
const require = createRequire(import.meta.url);
const canvasArgument = process.argv.find(value => value.startsWith('--canvas-module='))?.slice('--canvas-module='.length);
const canvasCandidates = [canvasArgument, process.env.TRX_CANVAS_MODULE, '@napi-rs/canvas',
  path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')].filter(Boolean);
let nativeCanvas, canvasModule;
for (const candidate of canvasCandidates) {
  try { nativeCanvas = require(candidate); canvasModule = candidate; break; } catch { /* Try the next local runtime. */ }
}
if (!nativeCanvas?.createCanvas) throw new Error('A native @napi-rs/canvas module is required. Pass --canvas-module=PATH; do not install it into this project.');

// The production asset/livery code runs unchanged. Real native canvas supplies
// Cyrillic text, paths, alpha and PNG encoding; GLTF transfer is local and closed.
const fixtureUrl = 'https://trx-export.invalid/ram-trx.glb';
const globalNames = ['document', 'self', 'HTMLCanvasElement', 'ImageData', 'createImageBitmap', 'FileReader', 'fetch', 'ProgressEvent'];
const originals = globalNames.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
const originalFetch = globalThis.fetch;
const replacements = {
  self: { URL },
  document: { createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = nativeCanvas.createCanvas(1, 1);
    // Native canvas exposes a data() method; Three.js reserves image.data for
    // raw DataTexture pixels. Browser HTMLCanvasElement has no such property.
    Object.defineProperty(canvas, 'data', { value: undefined });
    return canvas;
  } },
  HTMLCanvasElement: nativeCanvas.CanvasElement,
  ImageData: nativeCanvas.ImageData,
  createImageBitmap: async blob => nativeCanvas.loadImage(Buffer.from(await blob.arrayBuffer())),
  FileReader: class {
    async readAsArrayBuffer(blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
    async readAsDataURL(blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onloadend?.(); }
  },
  ProgressEvent: class extends Event { constructor(type, values) { super(type); Object.assign(this, values); } },
  fetch: async input => {
    const url = typeof input === 'string' ? input : input.url;
    // The verification loader decodes an embedded PNG through a local in-memory
    // Blob URL. This path uses no host, disk or network access.
    if (url.startsWith('blob:nodedata:')) return originalFetch(input);
    assert.equal(url, fixtureUrl, 'The export must not access external resources');
    return new Response(source, { headers: { 'Content-Type': 'model/gltf-binary', 'Content-Length': String(source.length) } });
  },
};
globalNames.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: replacements[name] }));

async function load(name, dependencies = {}) {
  const content = await readFile(path.join(project, `src/rc-game/${name}.ts`), 'utf8');
  const code = ts.transpileModule(content, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, dependency => {
    assert.ok(dependency in dependencies, `Unexpected export dependency: ${dependency}`);
    return dependencies[dependency];
  });
  return exports;
}
function srgb(color) {
  const converted = color.getRGB(new THREE.Color(), THREE.SRGBColorSpace);
  return [converted.r, converted.g, converted.b].map(number => number.toFixed(6)).join(' ');
}
function mtl(materials) {
  return [`# RAM TRX by ${info.author}, ${info.license}; Gorod Svet paint and livery.`,
    ...[...materials].map(material => {
      const specular = material.color.clone().multiplyScalar(material.metalness).addScalar(.04 * (1 - material.metalness));
      return [`newmtl ${material.name}`, 'Ka 0.000000 0.000000 0.000000',
        `Kd ${srgb(material.color)}`, `Ks ${srgb(specular)}`,
        `Ke ${srgb(material.emissive.clone().multiplyScalar(material.emissiveIntensity))}`,
        `Ns ${Math.min(1000, Math.max(0, 2 / Math.max(.01, material.roughness ** 2) - 2)).toFixed(6)}`,
        `d ${material.opacity.toFixed(6)}`, `illum ${material.transparent && material.opacity < 1 ? 4 : 2}`,
        `Pr ${material.roughness.toFixed(6)}`, `Pm ${material.metalness.toFixed(6)}`,
        ...(material.map ? [`map_Kd ${logoFile}`, `map_d ${alphaFile}`] : []), ''].join('\n');
    })].join('\n');
}
function manifest(glb) {
  assert.equal(glb.readUInt32LE(0), 0x46546c67); assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
  const length = glb.readUInt32LE(12); assert.equal(glb.readUInt32LE(16), 0x4e4f534a);
  const binaryOffset = 20 + length;
  assert.equal(glb.readUInt32LE(binaryOffset + 4), 0x004e4942);
  return { json: JSON.parse(glb.subarray(20, 20 + length).toString('utf8')),
    binary: glb.subarray(binaryOffset + 8) };
}

let rig;
try {
  const truck = await load('trxTruck', { three: THREE,
    'three/examples/jsm/geometries/RoundedBoxGeometry.js': { RoundedBoxGeometry } });
  const { createTrxAssetLoader } = await load('trxAsset', { three: THREE, './trxTruck': truck,
    'three/examples/jsm/loaders/GLTFLoader.js': { GLTFLoader },
    'three/examples/jsm/geometries/DecalGeometry.js': { DecalGeometry } });
  rig = await createTrxAssetLoader(fixtureUrl)();
  assert.equal(rig.body.userData.liveryCount, 3);
  const root = new THREE.Group(); root.name = 'RAM_TRX_GOROD_SVET';
  root.userData = { author: info.author, license: info.license, source: info.source,
    modifications: 'Prepared uniform RC scale; actual runtime gold/green PBR materials and projected Gorod Svet logo.' };
  root.add(rig.body);
  for (const rotor of rig.rotors) {
    rotor.position.fromArray(info.wheels.find(wheel => wheel.nodeName === rotor.name).pivot);
    rotor.traverse(object => { if (object.isMesh) object.name = `${rotor.name}_${object.name}`; });
    root.add(rotor);
  }
  const materials = new Set(); let geometryTriangles = 0, decalTriangles = 0, logoCanvas;
  root.traverse(object => {
    if (!object.isMesh) return;
    object.geometry.normalizeNormals();
    assert.ok(!Array.isArray(object.material), 'OBJ export requires the prepared single-material meshes');
    materials.add(object.material);
    const triangles = (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    if (object.name.startsWith('rc-trx-gorod-svet-')) {
      decalTriangles += triangles; object.material.name = 'gorod_svet_livery'; logoCanvas = object.material.map.image;
    } else geometryTriangles += triangles;
  });
  assert.equal(geometryTriangles, info.triangles); assert.ok(decalTriangles > 0); assert.ok(logoCanvas);
  root.updateMatrixWorld(true);
  await mkdir(output, { recursive: true });
  const logoPng = logoCanvas.toBuffer('image/png');
  const alphaCanvas = nativeCanvas.createCanvas(logoCanvas.width, logoCanvas.height);
  const logoPixels = logoCanvas.getContext('2d').getImageData(0, 0, logoCanvas.width, logoCanvas.height);
  const alphaPixels = alphaCanvas.getContext('2d').createImageData(logoCanvas.width, logoCanvas.height);
  for (let pixel = 0; pixel < logoPixels.data.length; pixel += 4) {
    alphaPixels.data[pixel] = alphaPixels.data[pixel + 1] = alphaPixels.data[pixel + 2] = logoPixels.data[pixel + 3];
    alphaPixels.data[pixel + 3] = 255;
  }
  alphaCanvas.getContext('2d').putImageData(alphaPixels, 0, 0);
  const alphaPng = alphaCanvas.toBuffer('image/png');
  const glb = Buffer.from(await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, trs: true,
    copyright: `Dodge RAM 1500 TRX by ${info.author}, ${info.license}. Source: ${info.source}. Gorod Svet paint/livery derivative.` }));
  const obj = `# ${info.title} by ${info.author}, ${info.license}; metres, +Y up, +Z forward.\nmtllib ${stem}.mtl\n${new OBJExporter().parse(root)}`;
  const materialText = mtl(materials);
  await Promise.all([
    writeFile(path.join(output, `${stem}.glb`), glb), writeFile(path.join(output, `${stem}.obj`), obj),
    writeFile(path.join(output, `${stem}.mtl`), materialText),
    writeFile(path.join(output, logoFile), logoPng), writeFile(path.join(output, alphaFile), alphaPng),
  ]);

  // Validate the saved files, not only the live Three.js scene.
  const saved = manifest(await readFile(path.join(output, `${stem}.glb`)));
  const savedTriangles = saved.json.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((subtotal, primitive) =>
    subtotal + saved.json.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3, 0), 0);
  assert.equal(savedTriangles, geometryTriangles + decalTriangles);
  const namedNodes = new Map(saved.json.nodes.map(node => [node.name, node]));
  for (const wheel of info.wheels) {
    assert.ok(namedNodes.has(wheel.nodeName), `Missing saved rotor ${wheel.nodeName}`);
    assert.deepEqual(namedNodes.get(wheel.nodeName).translation, wheel.pivot);
  }
  assert.ok(saved.json.buffers.every(buffer => !buffer.uri));
  assert.equal(saved.json.images.length, 1); assert.equal(saved.json.images[0].mimeType, 'image/png');
  assert.ok(saved.json.images.every(image => image.bufferView !== undefined && !image.uri));
  const pngView = saved.json.bufferViews[saved.json.images[0].bufferView];
  const embeddedPng = saved.binary.subarray(pngView.byteOffset ?? 0, (pngView.byteOffset ?? 0) + pngView.byteLength);
  const decoded = await nativeCanvas.loadImage(embeddedPng);
  assert.equal(decoded.width, logoCanvas.width); assert.equal(decoded.height, logoCanvas.height);
  const gold = saved.json.materials.find(material => material.name === 'x3_null__PAINT_1');
  const green = saved.json.materials.find(material => material.name === 'x3_null__PAINT_2');
  assert.ok(gold.extensions.KHR_materials_clearcoat.clearcoatFactor > .9);
  assert.ok(gold.pbrMetallicRoughness.baseColorFactor[0] > green.pbrMetallicRoughness.baseColorFactor[0]);
  assert.ok(saved.json.materials.find(material => material.name === 'gorod_svet_livery').pbrMetallicRoughness.baseColorTexture);
  const savedObj = await readFile(path.join(output, `${stem}.obj`), 'utf8');
  assert.equal((savedObj.match(/^f /gm) ?? []).length, savedTriangles);
  for (const wheel of info.wheels) assert.ok(savedObj.includes(`o ${wheel.nodeName}_`));
  const savedMtl = await readFile(path.join(output, `${stem}.mtl`), 'utf8');
  const declared = new Set([...savedMtl.matchAll(/^newmtl (.+)$/gm)].map(match => match[1]));
  for (const match of savedObj.matchAll(/^usemtl (.+)$/gm)) assert.ok(declared.has(match[1]));
  assert.ok(savedMtl.includes(`map_Kd ${logoFile}`)); assert.ok(savedMtl.includes(`map_d ${alphaFile}`));
  const externalLogo = await nativeCanvas.loadImage(await readFile(path.join(output, logoFile)));
  assert.equal(externalLogo.width, logoCanvas.width); assert.equal(externalLogo.height, logoCanvas.height);
  const savedBytes = await readFile(path.join(output, `${stem}.glb`));
  const reopened = await new GLTFLoader().parseAsync(savedBytes.buffer.slice(savedBytes.byteOffset, savedBytes.byteOffset + savedBytes.byteLength), '');
  const reopenedGeometries = new Set(), reopenedMaterials = new Set(), reopenedTextures = new Set();
  let reopenedTriangles = 0;
  reopened.scene.traverse(object => {
    if (!object.isMesh) return;
    reopenedGeometries.add(object.geometry);
    reopenedTriangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      reopenedMaterials.add(material);
      if (material.map) reopenedTextures.add(material.map);
    }
  });
  assert.equal(reopenedTriangles, savedTriangles);
  for (const wheel of info.wheels) assert.deepEqual(reopened.scene.getObjectByName(wheel.nodeName).position.toArray(), wheel.pivot);
  const reloadedPaint = [...reopenedMaterials].find(material => material.name === 'x3_null__PAINT_1');
  assert.equal(reloadedPaint.color.getHexString(), 'e8bc45');
  const reloadedLivery = [...reopenedMaterials].find(material => material.name === 'gorod_svet_livery');
  assert.equal(reloadedLivery.map.image.width, logoCanvas.width);
  assert.equal(reloadedLivery.map.image.height, logoCanvas.height);
  reopenedGeometries.forEach(geometry => geometry.dispose());
  reopenedMaterials.forEach(material => material.dispose()); reopenedTextures.forEach(texture => texture.dispose());
  const report = { ok: true, sourceTriangles: geometryTriangles, decalTriangles, totalTriangles: savedTriangles,
    rotors: info.wheelRuntimeOrder, materials: saved.json.materials.length, embeddedImages: saved.json.images.length,
    logoSize: [logoCanvas.width, logoCanvas.height], glbBytes: glb.length, objBytes: Buffer.byteLength(obj),
    reopenedWithGLTFLoader: true, canvasModule,
    files: [`${stem}.glb`, `${stem}.obj`, `${stem}.mtl`, logoFile, alphaFile] };
  await writeFile(path.join(output, `${stem}-validation.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  rig?.dispose();
  globalNames.forEach((name, index) => {
    if (originals[index]) Object.defineProperty(globalThis, name, originals[index]);
    else delete globalThis[name];
  });
}
