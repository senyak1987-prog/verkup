// Independent check of exported bytes, not of the in-memory preparation scene.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.resolve(project, '../3d-models/ram-trx-downloaded/prepared');
const data = await readFile(path.join(folder, 'ram-trx.glb'));
assert.equal(data.readUInt32LE(0), 0x46546c67, 'GLB magic');
assert.equal(data.readUInt32LE(4), 2, 'GLB version');
assert.equal(data.readUInt32LE(8), data.length, 'Complete GLB length');
const jsonLength = data.readUInt32LE(12);
const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
const binaryStart = 20 + jsonLength + 8;
const bin = data.subarray(binaryStart);
assert.equal(data.readUInt32LE(binaryStart - 4), 0x004e4942, 'Embedded BIN chunk');
assert.equal(data.readUInt32LE(binaryStart - 8), bin.length, 'Complete BIN length');
const metadata = JSON.parse(await readFile(path.join(folder, 'ram-trx-info.json'), 'utf8'));
const result = { triangles: 0, vertices: 0, meshes: json.meshes.length, materials: json.materials.length,
  invalidNumbers: 0, invalidNormals: 0, invalidIndices: 0, degenerateTriangles: 0,
  embeddedBuffers: json.buffers.every(buffer => !buffer.uri), textureCount: json.textures?.length ?? 0,
  extraUvs: 0, wheelGroups: [], objTriangles: 0 };
const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const readers = { 5121: ['readUInt8', 1], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4] };
function accessor(index) {
  const a = json.accessors[index], view = json.bufferViews[a.bufferView];
  const [reader, bytes] = readers[a.componentType], size = sizes[a.type];
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = view.byteStride ?? bytes * size;
  const values = [];
  for (let i = 0; i < a.count; ++i) for (let c = 0; c < size; ++c) values.push(bin[reader](base + i * stride + c * bytes));
  return values;
}
for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
  assert.equal(primitive.mode ?? 4, 4, 'Triangles');
  const positions = accessor(primitive.attributes.POSITION), normals = accessor(primitive.attributes.NORMAL), indices = accessor(primitive.indices);
  result.vertices += positions.length / 3; result.triangles += indices.length / 3;
  for (const value of positions) if (!Number.isFinite(value)) ++result.invalidNumbers;
  for (const value of normals) if (!Number.isFinite(value)) ++result.invalidNumbers;
  for (let i = 0; i < normals.length; i += 3) if (Math.abs(Math.hypot(normals[i], normals[i + 1], normals[i + 2]) - 1) > .001) ++result.invalidNormals;
  for (const index of indices) if (index >= positions.length / 3) ++result.invalidIndices;
  for (const semantic of Object.keys(primitive.attributes)) if (/^TEXCOORD_[1-9]$/.test(semantic)) ++result.extraUvs;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ab = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const ac = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (cross.reduce((sum, value) => sum + value * value, 0) <= 1e-20) ++result.degenerateTriangles;
  }
}
assert.ok(json.nodes.some(node => node.name === 'BODY'));
for (const wheel of metadata.wheels) {
  const node = json.nodes.find(node => node.name === wheel.nodeName);
  assert.ok(node, wheel.nodeName);
  assert.deepEqual(node.rotation ?? [0, 0, 0, 1], [0, 0, 0, 1], wheel.nodeName + ' rotation identity');
  assert.deepEqual(node.scale ?? [1, 1, 1], [1, 1, 1], wheel.nodeName + ' scale identity');
  assert.ok(node.children.length, wheel.nodeName + ' rotor meshes');
  for (let i = 0; i < 3; ++i) assert.ok(Math.abs(node.translation[i] - wheel.pivot[i]) < 1e-6, wheel.nodeName + ' authored pivot');
  result.wheelGroups.push(wheel.nodeName);
}
const obj = await readFile(path.join(folder, 'ram-trx.obj'), 'utf8');
for (const line of obj.split('\n')) if (line.startsWith('f ')) result.objTriangles += line.trim().split(/\s+/).length - 3;
assert.equal(result.triangles, metadata.triangles, 'GLB triangle count matches metadata');
assert.equal(result.objTriangles, result.triangles, 'OBJ triangle count matches GLB');
assert.equal(result.extraUvs, 0, 'No redundant TEXCOORD channels');
assert.equal(result.textureCount, 0, 'Source has no external textures');
assert.equal(result.embeddedBuffers, true, 'GLB is self-contained');
assert.ok(!(result.invalidNumbers || result.invalidNormals || result.invalidIndices || result.degenerateTriangles), 'Valid geometry');
assert.ok(metadata.triangles <= 101000, 'Approximately 100k triangle budget');
assert.ok(Math.abs(metadata.dimensions[2] - 2) < 1e-6, '2 metre normalized length');
const publicData = await readFile(path.join(project, 'public/models/ram-trx.glb'));
assert.equal(Buffer.compare(data, publicData), 0, 'Public game asset matches prepared GLB');
const attribution = await readFile(path.join(project, 'public/models/ram-trx-attribution.txt'), 'utf8');
assert.ok(attribution.includes('DR1KING100K') && attribution.includes('CC-BY-4.0') && attribution.includes('Changes made'));
result.ok = true;
await writeFile(path.join(folder, 'validation.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
