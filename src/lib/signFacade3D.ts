import * as THREE from 'three';
import { facadeRects, facadeSignPlacement, FACADE_SIGN_ANCHOR } from './signFacade';
import type { FacadeOptions, FacadeRect, SignPlacement } from './signFacade';
import { isPanelCornerMount, panelMountLayout } from './panelConstruction';
import type { PanelMountMode } from './panelConstruction';

type PanelFacadeMount = { mode: PanelMountMode; size: number; depth: number; gap: number; shape?: string; cornerRadius?: number };

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
  for (const texture of [color, bump]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 2; texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { color, bump };
}

function wallGeometry(rects: FacadeRect[], anchor: { x: number; y: number }) {
  const wall = rects.find(r => r.kind === 'wall')!;
  const { x: anchorX, y: anchorY } = anchor;
  const left = wall.x - anchorX, right = left + wall.w;
  const top = anchorY - wall.y, bottom = top - wall.h;
  const shape = new THREE.Shape();
  shape.moveTo(left, top); shape.lineTo(right, top); shape.lineTo(right, bottom); shape.lineTo(left, bottom); shape.closePath();
  for (const r of rects.filter(item => item.kind === 'opening')) {
    const hole = new THREE.Path(), holeLeft = r.x - anchorX, holeRight = holeLeft + r.w;
    const holeTop = anchorY - r.y, holeBottom = holeTop - r.h;
    hole.moveTo(holeLeft, holeTop); hole.lineTo(holeLeft, holeBottom); hole.lineTo(holeRight, holeBottom); hole.lineTo(holeRight, holeTop); hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: wall.depth ?? 200, bevelEnabled: false, steps: 1 });
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  // A 1000 × 560 texture contains 80 × 26 pixel bricks: 240 × 78 mm in the scene.
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (positions.getX(i) - left) / 3000, (positions.getY(i) - bottom) / 1680);
  return geometry;
}

export function createFacadeModel(place: SignPlacement, _signWidth: number, _signHeight: number,
  options: FacadeOptions & { panelMount?: PanelFacadeMount } = {}, panelWallSurface = false) {
  const group = new THREE.Group(); group.name = 'facade';
  if (options.panelMount) {
    const panel = options.panelMount;
    group.userData.panelMountMode = panel.mode;
    const wallShift = 4 + (place === 'canopy' ? 1500 : 0);
    const front = createFacadeModel(place, _signWidth, _signHeight, { palette: options.palette, signBackMm: 0 }, true);
    front.position.z = wallShift;
    if (isPanelCornerMount(panel.mode)) {
      front.name = 'facade-front'; front.position.x = -3900;
      const side = createFacadeModel(place, _signWidth, _signHeight, { palette: options.palette, signBackMm: 0 }, true);
      side.name = 'facade-side'; side.rotation.y = Math.PI / 2;
      side.position.set(wallShift, 0, -3900);
      const offset = front.userData.windowCount ?? 0;
      side.traverse(child => {
        const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (material?.userData.windowLight) {
          material.userData.windowIndex += offset;
          child.userData.windowIndex = material.userData.windowIndex;
        }
      });
      group.add(front, side);
    } else group.add(front);
    group.userData.signMountZ = 0;
    group.userData.windowCount = group.children.reduce((count, child) => count + (child.userData.windowCount ?? 0), 0);
    return group;
  }
  if (place === 'none') return group;
  const placement = facadeSignPlacement(place, _signWidth, _signHeight, options.signBackMm);
  const { x: anchorX, y: anchorY } = panelWallSurface ? FACADE_SIGN_ANCHOR : placement.anchor;
  const anchorZ = placement.surface.frontZ;
  const palette = options.palette ?? 'stone';
  const mountSurface = (r: FacadeRect) => !panelWallSurface || !['sign-mounting-band', 'sign-band-bottom', 'canopy-sign-upright'].includes(r.name ?? '');
  const dayRects = facadeRects(place, false, options, panelWallSurface).filter(mountSurface), nightRects = facadeRects(place, true, options, panelWallSurface).filter(mountSurface);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const leafGeometry = new THREE.SphereGeometry(.5, 10, 7);
  const masonry = palette === 'brick' ? masonryTexture() : undefined;
  group.userData.palette = palette; group.userData.signMountZ = anchorZ;
  group.userData.signAnchor = { x: anchorX, y: anchorY };
  group.userData.signFitsSurface = placement.fits;
  group.userData.signMountSurface = place === 'canopy' && !panelWallSurface ? 'canopy-frieze' : 'wall';
  let windowCount = 0;

  for (const [index, r] of dayRects.entries()) {
    const kind = r.kind ?? 'detail';
    const windowIndex = kind === 'glass' ? windowCount++ : undefined;
    const materialKey = kind + ':' + (kind === 'glass' ? r.name : r.color);
    let material = materials.get(materialKey);
    if (!material) {
      material = kind === 'glass'
        ? new THREE.MeshPhysicalMaterial({ color: r.color, roughness: .13, metalness: 0,
          ior: 1.5, clearcoat: 1, clearcoatRoughness: .075, specularIntensity: 1, envMapIntensity: 1.05 })
        : new THREE.MeshStandardMaterial({ color: r.color,
          roughness: kind === 'foliage' ? .86 : kind === 'wall' ? .98 : .77,
          metalness: r.name?.includes('frame') || r.name?.includes('canopy') ? .12 : 0, envMapIntensity: .3 });
      material.userData.dayColor = material.color.clone();
      material.userData.nightColor = new THREE.Color(nightRects[index].color);
      // Interior light remains independent of the sign's lighting switch.
      if (kind === 'glass') {
        material.emissive.set('#ffd8a1');
        material.userData.maxWindowEmission = .42 + (windowIndex! % 4) * .035;
        material.userData.maxEmission = material.userData.maxWindowEmission;
        material.userData.facadeEmission = true;
        material.userData.windowLight = true; material.userData.windowIndex = windowIndex;
        material.userData.nightColor = new THREE.Color('#324653');
        material.userData.dayEnvIntensity = 1.05; material.userData.nightEnvIntensity = .32;
      }
      if (kind === 'lamp') { material.emissive.set(nightRects[index].color); material.userData.maxEmission = .65; material.userData.facadeEmission = true; }
      if (kind === 'wall' && masonry) {
        material.color.set('#ffffff'); material.userData.dayColor = material.color.clone();
        material.userData.nightColor = material.color.clone().multiplyScalar(.58);
        material.map = masonry.color; material.bumpMap = masonry.bump; material.bumpScale = 1.3;
      }
      materials.set(materialKey, material);
    }
    let mesh: THREE.Mesh;
    if (kind === 'wall') {
      mesh = new THREE.Mesh(wallGeometry(dayRects, { x: anchorX, y: anchorY }), material);
      mesh.position.z = anchorZ + (r.z ?? 0) - (r.depth ?? 200);
    } else {
      const organic = kind === 'foliage' || kind === 'flower';
      mesh = new THREE.Mesh(organic ? leafGeometry : boxGeometry, material);
      mesh.scale.set(r.w, r.h, r.depth ?? .6);
      mesh.position.set(r.x + r.w / 2 - anchorX, anchorY - r.y - r.h / 2,
        anchorZ + (r.z ?? 0) - (r.depth ?? .6) / 2);
      if (r.rotation) mesh.rotation.z = -r.rotation * Math.PI / 180;
    }
    mesh.name = kind === 'wall' ? 'facade-wall' : 'facade-' + (r.name ?? 'detail');
    mesh.receiveShadow = kind !== 'lamp';
    mesh.castShadow = kind !== 'glass' && kind !== 'opening' && kind !== 'lamp';
    mesh.userData.facadeKind = kind;
    mesh.userData.frontZ = anchorZ + (r.z ?? 0);
    if (windowIndex !== undefined) mesh.userData.windowIndex = windowIndex;
    group.add(mesh);
  }
  group.userData.windowCount = windowCount;
  return group;
}

/** A cropped wall sample makes the same anchoring visible when no architectural scene is selected. */
export function createPanelMountContext(panel: PanelFacadeMount, palette: FacadeOptions['palette'] = 'stone') {
  const group = new THREE.Group(); group.name = 'panel-mount-context';
  const span = Math.max(750, panel.size * 1.2), height = Math.max(700, panel.size * 1.4), thickness = 90;
  const colors = { stone: '#d8d2c8', brick: '#bc8062', charcoal: '#68747d' };
  const material = new THREE.MeshStandardMaterial({ color: colors[palette ?? 'stone'], roughness: .96 });
  material.userData.dayColor = material.color.clone();
  const masonry = palette === 'brick' ? masonryTexture() : undefined;
  if (masonry) { material.map = masonry.color; material.bumpMap = masonry.bump; material.bumpScale = 1.3; }
  const addWall = (name: string, width: number, depth: number, x: number, z: number) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    wall.position.set(x, 0, z); wall.name = name; wall.receiveShadow = true; wall.castShadow = true;
    wall.userData.facadeKind = 'wall'; group.add(wall);
  };
  if (isPanelCornerMount(panel.mode)) {
    addWall('panel-context-front-wall', span, thickness, -span / 2, -thickness / 2);
    addWall('panel-context-side-wall', thickness, span, -thickness / 2, -span / 2);
  } else addWall('panel-context-front-wall', span, thickness, 0, -thickness / 2);
  group.userData.panelMount = panelMountLayout(panel.size, panel.shape ?? 'square', panel.gap, panel.cornerRadius, panel.depth, panel.mode);
  return group;
}
