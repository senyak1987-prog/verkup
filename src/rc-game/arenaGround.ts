import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { pavingCell, PAVER_WIDTH, PAVER_DEPTH, type RcSurface } from './terrainSurface';

/** Locally drawn, repeating mineral grain; no remote images or asynchronous textures. */
export function sandMaterial(width: number, depth: number) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#c9b58a'; context.fillRect(0, 0, 512, 512);
  let seed = 8137;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 14000; i++) {
    context.fillStyle = i % 3 === 0 ? '#f0dbb080' : i % 3 === 1 ? '#8c78523a' : '#bca37780';
    const radius = .3 + random() * 1.2;
    context.beginPath(); context.arc(random() * 512, random() * 512, radius, 0, Math.PI * 2); context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(width / 3.5, depth / 3.5); texture.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: .98, color: '#fff5df' });
}

/** Actual bevelled pavers share their per-cell height with the four tyre contacts. */
export function addPaving(parent: THREE.Group, surface: RcSurface) {
  const joint = .006;
  const geometry = new RoundedBoxGeometry(PAVER_WIDTH - joint, .10, PAVER_DEPTH - joint, 1, .004);
  const cells: Array<{ x: number; y: number; z: number; width: number; depth: number }> = [];
  const patches = (surface.paving ?? []).map(patch=>({...patch}));
  for(let i=0;i<patches.length;i++)for(let j=i+1;j<patches.length;j++) {
    const a=patches[i],b=patches[j];
    if(Math.abs(a.minX-b.minX)<.001&&Math.abs(a.maxX-b.maxX)<.001&&Math.abs(a.baseHeight-b.baseHeight)<.001
      &&Math.max(a.minZ,b.minZ)<=Math.min(a.maxZ,b.maxZ)+.001) {
      a.minZ=Math.min(a.minZ,b.minZ);a.maxZ=Math.max(a.maxZ,b.maxZ);patches.splice(j--,1);
    }
  }
  const seen = new Set<string>();
  for (const patch of patches) {
    for (let z = patch.minZ; z < patch.maxZ + PAVER_DEPTH; z += PAVER_DEPTH) {
      for (let x = patch.minX - PAVER_WIDTH / 2; x < patch.maxX + PAVER_WIDTH; x += PAVER_WIDTH) {
        const cell = pavingCell(x, z), key = `${cell.cx.toFixed(4)},${cell.cz.toFixed(4)}`;
        if (seen.has(key))continue;
        const left=Math.max(patch.minX,cell.cx-PAVER_WIDTH/2+joint/2),right=Math.min(patch.maxX,cell.cx+PAVER_WIDTH/2-joint/2);
        const back=Math.max(patch.minZ,cell.cz-PAVER_DEPTH/2+joint/2),front=Math.min(patch.maxZ,cell.cz+PAVER_DEPTH/2-joint/2);
        if(right-left<.025||front-back<.025)continue;
        if (surface.height(cell.cx, cell.cz) > patch.baseHeight + .06) continue;
        seen.add(key); cells.push({ x: (left+right)/2, y: patch.baseHeight + cell.top - .05, z: (back+front)/2,
          width:right-left,depth:front-back });
      }
    }
  }
  if (!cells.length) { geometry.dispose(); return; }
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .93 });
  const mesh = new THREE.InstancedMesh(geometry, material, cells.length); mesh.name = 'rc-physical-pavers';
  mesh.castShadow = mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4(), color = new THREE.Color();
  cells.forEach((cell, index) => {
    matrix.makeScale(cell.width/(PAVER_WIDTH-joint),1,cell.depth/(PAVER_DEPTH-joint));
    matrix.setPosition(cell.x, cell.y, cell.z); mesh.setMatrixAt(index, matrix);
    // Low-contrast mineral colours selected by position avoid repetitive diagonal stripes.
    const shade = Math.abs(Math.floor(cell.x * 7387) ^ Math.floor(cell.z * 1931)) % 5;
    color.setHex([0xb5b3aa, 0xb1afa6, 0xb9b7ae, 0xb3b1a8, 0xb7b5ac][shade]); mesh.setColorAt(index, color);
  });
  mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); parent.add(mesh);
}
