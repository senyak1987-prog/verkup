// Reproducible offline derivatives of the licensed, prepared model. No runtime simplification.
import { readFile, writeFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshoptSimplifier as simplify } from 'meshoptimizer/simplifier';

globalThis.FileReader = class {
  async readAsArrayBuffer(blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
};
await simplify.ready;
const source = await readFile('public/models/ram-trx.glb');
const report = { sourceBytes: source.length, variants: [] };
for (const [name, ratio, error] of [['mobile', .25, .035], ['far', .055, .075]]) {
  const { scene } = await new GLTFLoader().parseAsync(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), '');
  let triangles = 0;
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    const g = mesh.geometry, p = g.attributes.position, n = g.attributes.normal;
    g.computeBoundingBox();
    const locks = new Uint8Array(p.count);
    for (let i = 0; i < p.count; i++) for (const [axis, key] of ['x', 'y', 'z'].entries()) {
      const value = p.array[i * 3 + axis];
      if (Math.abs(value - g.boundingBox.min[key]) < 1e-6 || Math.abs(value - g.boundingBox.max[key]) < 1e-6) locks[i] = 1;
    }
    const target = Math.max(12, Math.floor(g.index.count * ratio / 3) * 3);
    const [indices] = simplify.simplifyWithAttributes(Uint32Array.from(g.index.array), p.array, 3,
      n.array, 3, [.1, .1, .1], locks, target, error, ['Permissive']);
    const [remap, count] = simplify.compactMesh(indices);
    const compact = new T.BufferGeometry();
    for (const [key, attribute] of Object.entries(g.attributes)) {
      const data = new Float32Array(count * attribute.itemSize);
      for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff)
        for (let c = 0; c < attribute.itemSize; c++) data[remap[i] * attribute.itemSize + c] = attribute.array[i * attribute.itemSize + c];
      compact.setAttribute(key, new T.BufferAttribute(data, attribute.itemSize));
    }
    compact.setIndex(new T.BufferAttribute(indices, 1));
    compact.computeBoundingBox(); compact.computeBoundingSphere();
    mesh.geometry = compact; g.dispose(); triangles += indices.length / 3;
  });
  scene.userData.lod = name;
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false, trs: true });
  await writeFile(`public/models/ram-trx-${name}.glb`, Buffer.from(glb));
  report.variants.push({ name, triangles, bytes: glb.byteLength });
}
await writeFile('public/models/ram-trx-lods.json', JSON.stringify(report, null, 2) + '\n');
console.log(report);
