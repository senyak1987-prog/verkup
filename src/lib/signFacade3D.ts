import * as THREE from 'three';
import { facadeRects } from './signFacade';
import type { FacadeOptions, FacadeRect, SignPlacement } from './signFacade';

/** Restrained masonry colour and shallow joints, with no high frequency glass texture. */
function masonryTexture(): { color: THREE.CanvasTexture; bump: THREE.CanvasTexture } | undefined {
  if (typeof document === 'undefined') return;
  const canvas = document.createElement('canvas'), heightMap = document.createElement('canvas');
  canvas.width = heightMap.width = 1000; canvas.height = heightMap.height = 560;
  const ctx = canvas.getContext('2d'), relief = heightMap.getContext('2d');
  if (!ctx || !relief) return;
  ctx.fillStyle = '#ab9580'; ctx.fillRect(0, 0, 1000, 560);
  relief.fillStyle = '#606060'; relief.fillRect(0, 0, 1000, 560);
  const shades = ['#bc8062', '#ba7e60', '#c08465', '#b87d61', '#bf8467'];
  for (let row = 0; row < 22; row++) for (let column = -1; column < 14; column++) {
    const x = column * 80 + (row % 2 ? 40 : 0), y = row * 26;
    ctx.fillStyle = shades[((row * 7 + column * 3) % shades.length + shades.length) % shades.length];
    ctx.fillRect(x + 1.5, y + 1.5, 77, 23);
    ctx.fillStyle = '#ce9272'; ctx.fillRect(x + 1.5, y + 1.5, 77, 1);
    relief.fillStyle = '#a5a5a5'; relief.fillRect(x + 2, y + 2, 76, 22);
    relief.fillStyle = '#8b8b8b'; relief.fillRect(x + 2, y + 23, 76, 1);
  }
  const color = new THREE.CanvasTexture(canvas), bump = new THREE.CanvasTexture(heightMap);
  color.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [color, bump]) { texture.anisotropy = 2; texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter; }
  return { color, bump };
}

function wallGeometry(rects: FacadeRect[], scale: number) {
  const wall = rects.find(r => r.kind === 'wall')!;
  const shape = new THREE.Shape();
  shape.moveTo(-250, 85); shape.lineTo(250, 85); shape.lineTo(250, 85 - wall.h); shape.lineTo(-250, 85 - wall.h); shape.closePath();
  for (const r of rects.filter(item => item.kind === 'opening')) {
    const hole = new THREE.Path(), left = r.x - 250, right = left + r.w, top = 85 - r.y, bottom = top - r.h;
    hole.moveTo(left, top); hole.lineTo(left, bottom); hole.lineTo(right, bottom); hole.lineTo(right, top); hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: wall.depth ?? 14, bevelEnabled: false, steps: 1 });
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (positions.getX(i) + 250) / 500, (positions.getY(i) + 195) / 280);
  geometry.scale(scale, scale, scale);
  return geometry;
}

export function createFacadeModel(place: SignPlacement, signWidth: number, signHeight: number, options: FacadeOptions = {}) {
  const group = new THREE.Group(); group.name = 'facade';
  if (place === 'none') return group;
  const scale = Math.max(signWidth / 300, signHeight / 76, 8);
  const anchorZ = -Math.max(0, options.signBackMm ?? 20) - 4;
  const palette = options.palette ?? 'stone';
  const dayRects = facadeRects(place, false, options), nightRects = facadeRects(place, true, options);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const leafGeometry = new THREE.SphereGeometry(.5, 10, 7);
  const masonry = palette === 'brick' ? masonryTexture() : undefined;
  group.userData.palette = palette; group.userData.signMountZ = anchorZ;

  for (const [index, r] of dayRects.entries()) {
    const kind = r.kind ?? 'detail';
    const materialKey = kind + ':' + r.color;
    let material = materials.get(materialKey);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: r.color,
        roughness: kind === 'glass' ? .47 : kind === 'foliage' ? .86 : kind === 'wall' ? .98 : .77,
        metalness: kind === 'glass' ? 0 : r.name?.includes('frame') || r.name?.includes('canopy') ? .12 : 0,
        envMapIntensity: kind === 'glass' ? .12 : .3 });
      material.userData.dayColor = material.color.clone();
      // Interior light remains independent of the sign's lighting switch.
      if (kind === 'glass') { material.emissive.set('#cfaa72'); material.userData.maxEmission = .3; material.userData.facadeEmission = true; }
      if (kind === 'lamp') { material.emissive.set(nightRects[index].color); material.userData.maxEmission = .65; material.userData.facadeEmission = true; }
      if (kind === 'wall' && masonry) {
        material.color.set('#ffffff'); material.userData.dayColor = material.color.clone();
        material.map = masonry.color; material.bumpMap = masonry.bump; material.bumpScale = 1.3;
      }
      materials.set(materialKey, material);
    }
    let mesh: THREE.Mesh;
    if (kind === 'wall') {
      mesh = new THREE.Mesh(wallGeometry(dayRects, scale), material);
      mesh.position.z = anchorZ + (r.z ?? 0) * scale - (r.depth ?? 14) * scale;
    } else {
      const organic = kind === 'foliage' || kind === 'flower';
      mesh = new THREE.Mesh(organic ? leafGeometry : boxGeometry, material);
      mesh.scale.set(r.w * scale, r.h * scale, (r.depth ?? .6) * scale);
      mesh.position.set((r.x + r.w / 2 - 250) * scale, (85 - r.y - r.h / 2) * scale,
        anchorZ + ((r.z ?? 0) - (r.depth ?? .6) / 2) * scale);
      if (r.rotation) mesh.rotation.z = -r.rotation * Math.PI / 180;
    }
    mesh.name = kind === 'wall' ? 'facade-wall' : 'facade-' + (r.name ?? 'detail');
    mesh.receiveShadow = kind !== 'glass' && kind !== 'lamp';
    mesh.castShadow = kind !== 'wall' && kind !== 'glass' && kind !== 'opening' && kind !== 'lamp';
    mesh.userData.facadeKind = kind;
    mesh.userData.frontZ = anchorZ + (r.z ?? 0) * scale;
    group.add(mesh);
  }
  return group;
}
