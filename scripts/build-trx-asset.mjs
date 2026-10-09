/** Prepare the licensed Sketchfab TRX download without running any downloaded code.
 * Usage: node scripts/build-trx-asset.mjs [--triangles=100000] [--full]
 * Source FBX transforms are baked; four authored wheel hubs become +X rotors.
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetDir = path.resolve(project, '../3d-models/ram-trx-downloaded');
const sourceDir = path.join(assetDir, 'source-gltf');
const outputDir = path.join(assetDir, 'prepared');
const publicDir = path.join(project, 'public/models');
const budgetArgument = process.argv.find(value => value.startsWith('--triangles='));
const targetTriangles = process.argv.includes('--full') ? Infinity : Number(budgetArgument?.split('=')[1] ?? 100000);
if (!(targetTriangles >= 20000)) throw new Error('Triangle budget must be at least 20000.');
const json = JSON.parse(await readFile(path.join(sourceDir, 'scene.gltf'), 'utf8'));
const binary = await readFile(path.join(sourceDir, 'scene.bin'));
if (json.buffers.length !== 1 || json.buffers[0].uri !== 'scene.bin') throw new Error('Unexpected source buffer.');
if (binary.length !== json.buffers[0].byteLength) throw new Error('Source buffer is incomplete.');
if (json.images?.length || json.textures?.length || json.skins?.length || json.animations?.length) {
  throw new Error('This processor expects the downloaded static untextured TRX model.');
}

// Node exporter only uses FileReader for the generated Blob, never a downloaded script.
globalThis.FileReader = class {
  async readAsArrayBuffer(blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
  async readAsDataURL(blob) { this.result = 'data:application/octet-stream;base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64'); this.onloadend?.(); }
};
const componentReaders = {
  5120: ['readInt8', 1], 5121: ['readUInt8', 1], 5122: ['readInt16LE', 2],
  5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4],
};
const itemSizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function accessor(index, indices = false) {
  const a = json.accessors[index], view = json.bufferViews[a.bufferView];
  if (a.sparse || !view) throw new Error('Unexpected sparse or absent accessor.');
  const [reader, bytes] = componentReaders[a.componentType];
  const itemSize = itemSizes[a.type], stride = view.byteStride ?? itemSize * bytes;
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const data = indices ? new Uint32Array(a.count) : new Float32Array(a.count * itemSize);
  for (let i = 0; i < a.count; ++i) for (let c = 0; c < itemSize; ++c) {
    let value = binary[reader](start + i * stride + c * bytes);
    if (a.normalized) {
      if (a.componentType === 5121) value /= 255;
      else if (a.componentType === 5123) value /= 65535;
      else if (a.componentType === 5120) value = Math.max(-1, value / 127);
      else if (a.componentType === 5122) value = Math.max(-1, value / 32767);
    }
    data[i * itemSize + c] = value;
  }
  return { data, itemSize };
}

const worlds = [], parents = new Map();
for (let i = 0; i < json.nodes.length; ++i) for (const child of json.nodes[i].children ?? []) parents.set(child, i);
function world(index) {
  if (worlds[index]) return worlds[index];
  const n = json.nodes[index], local = new T.Matrix4();
  if (n.matrix) local.fromArray(n.matrix);
  else local.compose(new T.Vector3().fromArray(n.translation ?? [0, 0, 0]),
    new T.Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]), new T.Vector3().fromArray(n.scale ?? [1, 1, 1]));
  worlds[index] = parents.has(index) ? world(parents.get(index)).clone().multiply(local) : local;
  return worlds[index];
}
const wheelNames = ['WHEEL_LF', 'WHEEL_RF', 'WHEEL_LR', 'WHEEL_RR'];
const wheelNodes = new Map(wheelNames.map(name => [name, json.nodes.findIndex(node => node.name === name)]));
for (const [name, index] of wheelNodes) if (index < 0) throw new Error('Missing ' + name);
const wheelSourcePivots = Object.fromEntries([...wheelNodes].map(([name, index]) => [name, new T.Vector3().setFromMatrixPosition(world(index))]));
const meanHub = new T.Vector3();
for (const p of Object.values(wheelSourcePivots)) meanHub.add(p);
meanHub.multiplyScalar(0.25);
const chassisIndex = json.nodes.findIndex(node => node.name === 'chassis');
const chassisY = new T.Vector3().setFromMatrixPosition(world(chassisIndex)).y;
const origin = new T.Vector3(meanHub.x, chassisY, meanHub.z);
const sourceBounds = new T.Box3();
const sourceGroups = new Map();
const hierarchy = [];
let sourceTriangles = 0, discardedUvBytes = 0, sourceVertices = 0, cleanedTriangles = 0;
const sourceMaterials = (json.materials ?? []).map((m, index) => {
  const pbr = m.pbrMetallicRoughness ?? {}, rgba = pbr.baseColorFactor ?? [1, 1, 1, 1];
  const material = new T.MeshStandardMaterial({
    color: new T.Color().setRGB(...rgba.slice(0, 3), T.LinearSRGBColorSpace),
    metalness: pbr.metallicFactor ?? 1, roughness: pbr.roughnessFactor ?? 1,
    opacity: rgba[3], transparent: m.alphaMode === 'BLEND',
    alphaTest: m.alphaMode === 'MASK' ? m.alphaCutoff ?? 0.5 : 0,
    side: m.doubleSided ? T.DoubleSide : T.FrontSide,
    emissive: new T.Color().setRGB(...(m.emissiveFactor ?? [0, 0, 0]), T.LinearSRGBColorSpace),
  });
  material.name = m.name ?? `material_${index}`;
  return material;
});
function category(index) {
  let cursor = index;
  while (cursor !== undefined) {
    if (wheelNames.includes(json.nodes[cursor].name)) return json.nodes[cursor].name;
    cursor = parents.get(cursor);
  }
  return 'BODY';
}
function clean(geometry, recordSource = true) {
  const p = geometry.attributes.position, ix = geometry.index.array, good = [];
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  for (let i = 0; i < ix.length; i += 3) {
    a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]); c.fromBufferAttribute(p, ix[i + 2]);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-20) good.push(ix[i], ix[i + 1], ix[i + 2]);
    else if (recordSource) ++cleanedTriangles;
  }
  geometry.setIndex(new T.Uint32BufferAttribute(good, 1));
  return geometry;
}
for (let i = 0; i < json.nodes.length; ++i) {
  const node = json.nodes[i], transform = world(i);
  const entry = { index: i, name: node.name, parent: parents.get(i) ?? null,
    group: category(i), pivot: new T.Vector3().setFromMatrixPosition(transform).toArray(),
    sourceMesh: node.mesh ?? null, children: node.children ?? [], triangles: 0 };
  if (node.mesh !== undefined) for (const primitive of json.meshes[node.mesh].primitives) {
    if ((primitive.mode ?? 4) !== 4) throw new Error('Source primitive is not triangles.');
    const geometry = new T.BufferGeometry();
    for (const [semantic, index] of Object.entries(primitive.attributes)) {
      if (/^TEXCOORD_[1-9]$/.test(semantic)) { const a = json.accessors[index]; discardedUvBytes += a.count * 8; continue; }
      const key = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv' }[semantic];
      if (!key) continue;
      const { data, itemSize } = accessor(index);
      geometry.setAttribute(key, new T.BufferAttribute(data, itemSize));
    }
    const p = geometry.attributes.position;
    geometry.setIndex(new T.Uint32BufferAttribute(primitive.indices === undefined ? Array.from({ length: p.count }, (_, n) => n) : accessor(primitive.indices, true).data, 1));
    geometry.applyMatrix4(transform);
    if (transform.determinant() < 0) { const ix = geometry.index.array; for (let n = 0; n < ix.length; n += 3) [ix[n + 1], ix[n + 2]] = [ix[n + 2], ix[n + 1]]; }
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    geometry.normalizeNormals();
    geometry.computeBoundingBox(); sourceBounds.union(geometry.boundingBox);
    const count = geometry.index.count / 3;
    entry.triangles += count; sourceTriangles += count; sourceVertices += p.count;
    clean(geometry);
    const group = entry.group, materialIndex = primitive.material ?? 0;
    if (!sourceGroups.has(group)) sourceGroups.set(group, new Map());
    const bucket = sourceGroups.get(group);
    if (!bucket.has(materialIndex)) bucket.set(materialIndex, []);
    bucket.get(materialIndex).push({ geometry, sourceNode: node.name, index: i });
  }
  hierarchy.push(entry);
}
const uniformScale = 2 / sourceBounds.getSize(new T.Vector3()).z;
const normalizePoint = value => value.clone().sub(origin).multiplyScalar(uniformScale);
const normalizeMatrix = new T.Matrix4().makeScale(uniformScale, uniformScale, uniformScale)
  .multiply(new T.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
const root = new T.Group(); root.name = 'RAM_TRX';
const stats = [];
const preparedMeshes = [];
for (const groupName of ['BODY', ...wheelNames]) {
  const group = new T.Group(); group.name = groupName;
  const pivot = groupName === 'BODY' ? new T.Vector3() : normalizePoint(wheelSourcePivots[groupName]);
  group.position.copy(pivot); root.add(group);
  for (const [materialIndex, sources] of sourceGroups.get(groupName)) {
    for (const item of sources) { item.geometry.applyMatrix4(normalizeMatrix); item.geometry.translate(-pivot.x, -pivot.y, -pivot.z); }
    // Consolidate only equal materials, preserving distinct shading/paint boundaries.
    const geometry = clean(mergeVertices(mergeGeometries(sources.map(item => item.geometry)), 1e-6));
    const originalCount = geometry.index.count / 3;
    const mesh = new T.Mesh(geometry, sourceMaterials[materialIndex]);
    mesh.name = groupName + '__' + mesh.material.name;
    mesh.userData.sourceNodes = sources.map(item => item.sourceNode);
    group.add(mesh);
    preparedMeshes.push({ mesh, originalGeometry: geometry.clone(), originalCount, groupName });
    stats.push({ group: groupName, material: mesh.material.name, before: originalCount });
  }
}

await MeshoptSimplifier.ready;
function simplifyGeometry(originalGeometry, ratio) {
  const geometry = originalGeometry.clone(), positions = geometry.attributes.position.array;
  const normals = geometry.attributes.normal.array, indices = Uint32Array.from(geometry.index.array);
  const originalCount = indices.length / 3;
  const target = Math.max(Math.min(64, originalCount), Math.floor(originalCount * ratio));
  if (target >= originalCount) return { geometry, error: 0 };
  // Lock each material's topological borders and global extrema. Permissive only
  // releases duplicated normal/UV seams inside that same material mesh.
  const remap = MeshoptSimplifier.generatePositionRemap(positions, 3), edges = new Map();
  for (let i = 0; i < indices.length; i += 3) for (let e = 0; e < 3; ++e) {
    const a = remap[indices[i + e]], b = remap[indices[i + (e + 1) % 3]];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  const border = new Set();
  for (const [key, count] of edges) if (count === 1) for (const id of key.split(',')) border.add(Number(id));
  const locks = new Uint8Array(positions.length / 3);
  geometry.computeBoundingBox(); const bounds = geometry.boundingBox;
  for (let i = 0; i < locks.length; ++i) {
    if (border.has(remap[i])) locks[i] = 1;
    for (let axis = 0; axis < 3; ++axis) {
      const key = ['x', 'y', 'z'][axis], value = positions[i * 3 + axis];
      if (Math.abs(value - bounds.min[key]) < 1e-6 || Math.abs(value - bounds.max[key]) < 1e-6) locks[i] = 1;
    }
  }
  const [result, error] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, normals, 3,
    [0.1, 0.1, 0.1], locks, target * 3, 0.014, ['Permissive']);
  const [compact, count] = MeshoptSimplifier.compactMesh(result);
  const compacted = new T.BufferGeometry();
  for (const [key, attribute] of Object.entries(geometry.attributes)) {
    const data = new Float32Array(count * attribute.itemSize);
    for (let i = 0; i < compact.length; ++i) if (compact[i] !== 0xffffffff) {
      for (let c = 0; c < attribute.itemSize; ++c) data[compact[i] * attribute.itemSize + c] = attribute.array[i * attribute.itemSize + c];
    }
    compacted.setAttribute(key, new T.BufferAttribute(data, attribute.itemSize));
  }
  compacted.setIndex(new T.Uint32BufferAttribute(result, 1)); clean(compacted, false); compacted.normalizeNormals();
  compacted.computeBoundingBox(); compacted.computeBoundingSphere();
  return { geometry: compacted, error };
}
let ratio = Math.min(1, targetTriangles / (sourceTriangles - cleanedTriangles));
let triangleCount = 0;
for (let pass = 0; pass < 10; ++pass) {
  triangleCount = 0;
  for (let i = 0; i < preparedMeshes.length; ++i) {
    const entry = preparedMeshes[i], result = simplifyGeometry(entry.originalGeometry, ratio);
    entry.mesh.geometry = result.geometry;
    const count = result.geometry.index.count / 3; triangleCount += count;
    stats[i].after = count; stats[i].relativeError = result.error;
  }
  console.log(`Simplification pass ${pass + 1}: ${triangleCount} triangles (ratio ${ratio.toFixed(4)}).`);
  if (triangleCount <= targetTriangles * 1.01 || ratio >= 1) break;
  ratio *= Math.max(0.45, Math.min(0.94, targetTriangles / triangleCount));
}
root.updateMatrixWorld(true);
function boundsOf(object) { const box = new T.Box3().setFromObject(object, true); return { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new T.Vector3()).toArray() }; }
function validate(object) {
  const result = { triangles: 0, vertices: 0, invalidNumbers: 0, invalidIndices: 0, degenerateTriangles: 0, invalidNormals: 0 };
  object.traverse(mesh => {
    if (!mesh.isMesh) return;
    const g = mesh.geometry, p = g.attributes.position, n = g.attributes.normal, ix = g.index.array;
    result.triangles += ix.length / 3; result.vertices += p.count;
    for (const value of p.array) if (!Number.isFinite(value)) ++result.invalidNumbers;
    for (const value of ix) if (value < 0 || value >= p.count) ++result.invalidIndices;
    for (let i = 0; i < n.count; ++i) { const length = new T.Vector3().fromBufferAttribute(n, i).length(); if (!Number.isFinite(length) || Math.abs(length - 1) > 0.001) ++result.invalidNormals; }
    const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
    for (let i = 0; i < ix.length; i += 3) {
      a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]); c.fromBufferAttribute(p, ix[i + 2]);
      if (b.sub(a).cross(c.sub(a)).lengthSq() <= 1e-20) ++result.degenerateTriangles;
    }
  });
  result.ok = !(result.invalidNumbers || result.invalidIndices || result.degenerateTriangles || result.invalidNormals);
  if (!result.ok) throw new Error('Prepared geometry failed validation: ' + JSON.stringify(result));
  return result;
}
const validation = validate(root);
const wheelMetadata = wheelNames.map(name => {
  const group = root.getObjectByName(name), localBox = new T.Box3();
  for (const child of group.children) localBox.union(child.geometry.boundingBox);
  const size = localBox.getSize(new T.Vector3());
  return { sourceName: name, nodeName: name, sourcePivot: wheelSourcePivots[name].toArray(),
    pivot: group.position.toArray(), radius: Math.max(size.y, size.z) / 2, width: size.x,
    localBounds: { min: localBox.min.toArray(), max: localBox.max.toArray() },
    triangles: stats.filter(item => item.group === name).reduce((sum, item) => sum + item.after, 0), spinAxis: '+X' };
});
const frontTrackWidth = wheelSourcePivots.WHEEL_LF.distanceTo(wheelSourcePivots.WHEEL_RF) * uniformScale;
const rearTrackWidth = wheelSourcePivots.WHEEL_LR.distanceTo(wheelSourcePivots.WHEEL_RR) * uniformScale;
const bodyBounds = boundsOf(root.getObjectByName('BODY'));
const metadata = {
  title: 'Dodge RAM 1500 TRX', author: 'DR1KING100K',
  source: 'https://sketchfab.com/3d-models/dodge-ram-1500-trx-d6d548c5fe9f4749813f0a386edfd42c',
  license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  generatedBy: 'verkup/scripts/build-trx-asset.mjs',
  modifications: 'Baked transforms, consolidated equal materials, removed TEXCOORD_1..9, normal-aware mesh decimation, normalized uniform scale and wheel pivots.',
  sourceTriangles, sourceVertices, sourceByteLength: binary.length, discardedUvBytes, cleanedTriangles,
  triangles: validation.triangles, vertices: validation.vertices, targetTriangles: Number.isFinite(targetTriangles) ? targetTriangles : sourceTriangles,
  normalization: { length: 2, uniformScale, sourceOrigin: origin.toArray(), sourceWheelPivotMean: meanHub.toArray(), up: '+Y', front: '+Z', units: 'metres' },
  rootName: root.name, bodyName: 'BODY', wheelNames, wheelRuntimeOrder: ['WHEEL_RF', 'WHEEL_LF', 'WHEEL_RR', 'WHEEL_LR'],
  dimensions: boundsOf(root).size, bounds: boundsOf(root), bodyBounds, roofTop: bodyBounds.max[1],
  wheelBase: (wheelSourcePivots.WHEEL_LF.z - wheelSourcePivots.WHEEL_LR.z) * uniformScale,
  frontTrackWidth, rearTrackWidth, trackWidth: (frontTrackWidth + rearTrackWidth) / 2,
  wheelRadius: wheelMetadata.reduce((sum, item) => sum + item.radius, 0) / 4,
  bodyRestHeight: (chassisY - meanHub.y) * uniformScale + wheelMetadata.reduce((sum, item) => sum + item.radius, 0) / 4,
  wheels: wheelMetadata, materialNames: sourceMaterials.map(material => material.name),
  spareWheel: 'rxx_trx_tire.017..020 remain static in BODY',
  simplification: { algorithm: 'meshoptimizer simplifyWithAttributes', normalWeights: [0.1, 0.1, 0.1], maximumRelativeError: 0.014,
    preserves: 'material borders, authored normal attributes, mesh extrema and rotor pivots', detail: stats }, validation,
};
root.userData.assetMetadata = { source: metadata.source, author: metadata.author, license: metadata.license, triangles: metadata.triangles };
await mkdir(outputDir, { recursive: true }); await mkdir(publicDir, { recursive: true });
const glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false, trs: true });
await writeFile(path.join(outputDir, 'ram-trx.glb'), Buffer.from(glb));
await writeFile(path.join(outputDir, 'ram-trx.obj'), 'mtllib ram-trx.mtl\n' + new OBJExporter().parse(root));
const mtl = sourceMaterials.map(m => `newmtl ${m.name}\nKd ${m.color.r} ${m.color.g} ${m.color.b}\nKs ${m.metalness} ${m.metalness} ${m.metalness}\nNs ${Math.max(1, Math.round((1 - m.roughness) * 400))}\nd ${m.opacity}\nillum 2\n`).join('\n');
await writeFile(path.join(outputDir, 'ram-trx.mtl'), mtl);
await writeFile(path.join(outputDir, 'ram-trx-info.json'), JSON.stringify(metadata, null, 2) + '\n');
await writeFile(path.join(outputDir, 'source-hierarchy.json'), JSON.stringify({ sourceComplete: true, rootNodes: json.scenes[json.scene ?? 0].nodes, nodes: hierarchy }, null, 2) + '\n');
await copyFile(path.join(sourceDir, 'license.txt'), path.join(outputDir, 'license.txt'));
const attribution = (await readFile(path.join(sourceDir, 'license.txt'), 'utf8')) + '\n\nChanges made for Gorod Svet RC playground: ' + metadata.modifications + '\n';
await writeFile(path.join(outputDir, 'ram-trx-attribution.txt'), attribution);
await copyFile(path.join(outputDir, 'ram-trx.glb'), path.join(publicDir, 'ram-trx.glb'));
await copyFile(path.join(outputDir, 'ram-trx-info.json'), path.join(publicDir, 'ram-trx-info.json'));
await copyFile(path.join(sourceDir, 'license.txt'), path.join(publicDir, 'ram-trx-license.txt'));
await writeFile(path.join(publicDir, 'ram-trx-attribution.txt'), attribution);
console.log(JSON.stringify({ glbBytes: glb.byteLength, triangles: metadata.triangles, dimensions: metadata.dimensions, profile: { wheelBase: metadata.wheelBase, frontTrackWidth, rearTrackWidth, wheelRadius: metadata.wheelRadius, bodyRestHeight: metadata.bodyRestHeight }, validation }, null, 2));
