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
  options: FacadeOptions & { panelMount?: PanelFacadeMount; frontSign?: boolean } = {}, panelWallSurface = false) {
  const group = new THREE.Group(); group.name = 'facade';
  if (options.panelMount) {
    const panel = options.panelMount;
    group.userData.panelMountMode = panel.mode;
    const wallShift = 4 + (place === 'canopy' ? 1500 : 0);
    const front = createFacadeModel(place, _signWidth, _signHeight, { palette: options.palette, signBackMm: 0 }, !options.frontSign);
    front.position.z = wallShift;
    if (isPanelCornerMount(panel.mode)) {
      front.name = 'facade-front'; front.position.x = -3900;
      const side = createFacadeModel(place, _signWidth, _signHeight, { palette: options.palette, signBackMm: 0 }, !options.frontSign);
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

/** Two independently sized products share one building and the same wall planes. */
export function attachFacadePair(model: THREE.Group, companion: THREE.Group, primaryKind: string,
  place: Exclude<SignPlacement, 'none'>, panel: PanelFacadeMount, frontWidth: number, frontHeight: number,
  palette: FacadeOptions['palette'] = 'stone') {
  const primary = new THREE.Group(); primary.name = 'primary-sign';
  for (const child of [...model.children]) primary.add(child);
  companion.name = 'companion-sign';
  const frontSign = primaryKind === 'panel' ? companion : primary;
  const panelSign = primaryKind === 'panel' ? primary : companion;
  const pose = panelMountLayout(panel.size, panel.shape ?? 'square', panel.gap, panel.cornerRadius, panel.depth, panel.mode);
  const facade = createFacadeModel(place, frontWidth, frontHeight, { palette, panelMount: pose, frontSign: true });
  facade.updateWorldMatrix(true, true);
  const wall = new THREE.Box3().setFromObject(facade.getObjectByName('facade-wall')!);
  const surface = new THREE.Box3().setFromObject(facade.getObjectByName(place === 'canopy' ? 'facade-canopy-fascia' : 'facade-sign-mounting-band')!);
  const frontBounds = new THREE.Box3().setFromObject(frontSign);
  const centre = surface.getCenter(new THREE.Vector3());
  frontSign.position.set(centre.x, centre.y, surface.max.z - frontBounds.min.z + 4);
  panelSign.rotation.y = pose.rotationY;
  panelSign.position.set(pose.position.x + (isPanelCornerMount(panel.mode) ? wall.max.x : wall.max.x - 600),
    centre.y + pose.position.y, wall.max.z + pose.position.z);
  panelSign.userData.mountMode = pose.mode;
  model.add(primary, companion, facade);
  if (primaryKind === 'panel') model.userData.panelPose = pose;
  model.userData.contextProducts = [primaryKind, primaryKind === 'panel' ? 'letters' : 'panel'];
  return facade;
}

export const SCALE_PERSON_HEIGHT_MM = 1750;

/** Product switches affect only the products, keeping the building and camera stable. */
export function setFacadeProductVisibility(model: THREE.Group, showSign: boolean, showPanel: boolean) {
  const primary = model.getObjectByName('primary-sign');
  const companion = model.getObjectByName('companion-sign');
  if (primary) primary.visible = model.userData.productId === 'panel' ? showPanel : showSign;
  else {
    const construction = model.getObjectByName('panel-construction');
    if (construction) construction.visible = showPanel;
  }
  if (companion) companion.visible = model.userData.productId === 'panel' ? showSign : showPanel;
  model.userData.visibleProducts = (model.userData.contextProducts ?? [model.userData.productId])
    .filter((kind: string) => kind === 'panel' ? showPanel : showSign);
}

/** Reuse the site's own bulb and wordmark, printed into a transparent textile decal. */
export async function loadScalePersonBrand(baseUrl: string) {
  const loader = new THREE.TextureLoader();
  const textures = await Promise.all([loader.loadAsync(baseUrl + 'gorod-svet-bulb.png'), loader.loadAsync(baseUrl + 'gorod-svet-wordmark.svg')]);
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const bulb = textures[0].image as HTMLImageElement, wordmark = textures[1].image as HTMLImageElement;
  const draw = (image: HTMLImageElement, x: number, y: number, w: number, h: number) => {
    const scale = Math.min(w / image.width, h / image.height), width = image.width * scale, height = image.height * scale;
    ctx.drawImage(image, x + (w - width) / 2, y + (h - height) / 2, width, height);
  };
  draw(wordmark, 12, 308, 1000, 180);
  // The official lettering printed in light ink remains readable on green fabric.
  ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#f4efe4'; ctx.fillRect(0, 0, 1024, 512);
  ctx.globalCompositeOperation = 'source-over'; draw(bulb, 380, 12, 264, 280);
  textures.forEach(texture => texture.dispose());
  const print = new THREE.CanvasTexture(canvas); print.colorSpace = THREE.SRGBColorSpace;
  print.anisotropy = 4; return print;
}

/** A detailed clothed observer, in millimetres, with a smooth silhouette and no polygon edges. */
export function createScalePerson(facade: THREE.Group, target: THREE.Vector3, brand?: THREE.Texture) {
  const pavement = facade.getObjectByName('facade-pavement');
  if (!pavement) return null;
  facade.updateWorldMatrix(true, true);
  const ground = new THREE.Box3().setFromObject(pavement);
  const person = new THREE.Group(); person.name = 'scale-person';
  person.userData.heightMm = SCALE_PERSON_HEIGHT_MM;
  const cloth = (color: string, roughness = .9) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, envMapIntensity: .3 });
    material.userData.dayColor = material.color.clone(); return material;
  };
  const sweatshirt = cloth('#184d3e'), ribbing = cloth('#123a30'), trousers = cloth('#30343a'), skin = cloth('#b98a6e', .72);
  const hair = cloth('#332a26'), shoes = cloth('#1b2025', .68), sole = cloth('#7b7e77');
  const sphere = new THREE.SphereGeometry(1, 64, 48);
  const add = (geometry: THREE.BufferGeometry, name: string, position: THREE.Vector3, material: THREE.Material = sweatshirt) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.position.copy(position); mesh.castShadow = true; mesh.receiveShadow = true; person.add(mesh); return mesh;
  };
  const oval = (name: string, x: number, y: number, z: number, width: number, height: number, depth: number, material: THREE.Material = sweatshirt) => {
    const mesh = add(sphere, name, new THREE.Vector3(x, y, z), material); mesh.scale.set(width, height, depth); return mesh;
  };
  const limb = (name: string, start: THREE.Vector3, end: THREE.Vector3, radius: number, material: THREE.Material = sweatshirt) => {
    const axis = end.clone().sub(start), length = axis.length();
    const mesh = add(new THREE.CapsuleGeometry(radius, Math.max(0, length - 2 * radius), 16, 48), name, start.clone().add(end).multiplyScalar(.5), material);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()); return mesh;
  };
  const profile = new THREE.SplineCurve([
    new THREE.Vector2(0, 912), new THREE.Vector2(142, 920), new THREE.Vector2(157, 980),
    new THREE.Vector2(145, 1100), new THREE.Vector2(175, 1260), new THREE.Vector2(203, 1380),
    new THREE.Vector2(187, 1450), new THREE.Vector2(104, 1492), new THREE.Vector2(58, 1510), new THREE.Vector2(0, 1510),
  ]).getPoints(100);
  const torso = add(new THREE.LatheGeometry(profile, 96), 'person-torso', new THREE.Vector3()); torso.scale.z = .61;
  oval('person-waist-rib', 0, 938, 0, 153, 31, 98, ribbing);
  oval('person-neck', 0, 1515, 0, 42, 63, 43, skin);
  oval('person-head', 0, 1635, 0, 97, 115, 94, skin);
  const hairCap = add(new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI * .56), 'person-hair', new THREE.Vector3(0, 1635, 0), hair);
  hairCap.scale.set(98, 115, 95);
  oval('person-hood', 0, 1488, -37, 111, 70, 86, ribbing);
  // A rounded hood opening and neckline, rather than a disconnected black head and torso.
  const collar = add(new THREE.TorusGeometry(55, 12, 20, 72), 'person-collar', new THREE.Vector3(0, 1512, 0), ribbing); collar.rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) {
    oval('person-ear', side * 96, 1630, 0, 16, 31, 16, skin);
    limb('person-thigh', new THREE.Vector3(side * 75, 957, 0), new THREE.Vector3(side * 83, 520, 8), 78, trousers);
    limb('person-calf', new THREE.Vector3(side * 83, 545, 8), new THREE.Vector3(side * 88, 85, 0), 58, trousers);
    oval('person-knee', side * 83, 528, 14, 61, 78, 61, trousers);
    oval('person-shoe-sole', side * 88, 15, 50, 69, 15, 142, sole);
    oval('person-shoe', side * 88, 45, 45, 67, 31, 137, shoes);
    oval('person-shoe-upper', side * 88, 66, 22, 58, 27, 80, shoes);
    limb('person-upper-arm', new THREE.Vector3(side * 185, 1415, 0), new THREE.Vector3(side * 231, 1115, 0), 72);
    limb('person-forearm', new THREE.Vector3(side * 231, 1120, 0), new THREE.Vector3(side * 248, 867, 20), 52);
    oval('person-cuff', side * 248, 891, 18, 48, 26, 46, ribbing);
    oval('person-hand', side * 248, 836, 20, 35, 52, 26, skin);
    for (let finger = 0; finger < 4; finger++) limb('person-finger', new THREE.Vector3(side * (229 + finger * 12), 818, 20), new THREE.Vector3(side * (229 + finger * 12), 777 + Math.abs(1.5 - finger) * 7, 24), 7, skin);
    limb('person-thumb', new THREE.Vector3(side * 220, 848, 31), new THREE.Vector3(side * 208, 812, 38), 10, skin);
    for (let lace = 0; lace < 4; lace++) limb('person-shoelace', new THREE.Vector3(side * 88 - 26, 87 - lace * 3, 16 + lace * 17), new THREE.Vector3(side * 88 + 26, 87 - lace * 3, 16 + lace * 17), 1.6, sole);
  }
  const stitch = (name: string, points: THREE.Vector3[], radius: number, material: THREE.Material = ribbing) =>
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, radius, 12, false), name, new THREE.Vector3(), material);
  for (const side of [-1, 1]) {
    stitch('person-pocket-seam', [new THREE.Vector3(side * 14, 1040, 88), new THREE.Vector3(side * 80, 1052, 78), new THREE.Vector3(side * 121, 1130, 66)], 2.4);
    stitch('person-hood-cord', [new THREE.Vector3(side * 40, 1480, 55), new THREE.Vector3(side * 44, 1400, 105), new THREE.Vector3(side * 37, 1330, 106)], 2, sole);
  }
  const textileProfile = profile.filter(point => point.x > 50).sort((a, b) => a.y - b.y);
  const radiusAt = (y: number) => {
    const index = textileProfile.findIndex(point => point.y >= y);
    if (index <= 0) return textileProfile[Math.max(0, index)].x;
    const a = textileProfile[index - 1], b = textileProfile[index];
    return THREE.MathUtils.lerp(a.x, b.x, (y - a.y) / Math.max(.001, b.y - a.y));
  };
  const print = (name: string, y: number, w: number, h: number, back: boolean) => {
    const geometry = new THREE.PlaneGeometry(w, h, 48, 24), positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), height = positions.getY(i) + y, radius = radiusAt(height);
      positions.setZ(i, (back ? -1 : 1) * (Math.sqrt(Math.max(1, radius * radius - x * x)) * .61 + 1));
      if (back) positions.setX(i, -x); // Readable from the back, not mirrored through the body.
    }
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ map: brand ?? null, color: '#ffffff', transparent: true, alphaTest: .04, roughness: .94,
      metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
    material.userData.dayColor = material.color.clone(); material.userData.textileBrand = true;
    const decal = add(geometry, name, new THREE.Vector3(0, y, 0), material); decal.userData.brand = 'Город Свет';
    // Do not draw an opaque placeholder if brand images have not loaded.
    decal.visible = Boolean(brand);
  };
  print('person-gorod-svet-back', 1320, 270, 135, true);
  print('person-gorod-svet-chest', 1355, 118, 59, false);
  person.position.set(THREE.MathUtils.clamp(target.x + 1100, ground.min.x + 350, ground.max.x - 350), ground.max.y, ground.max.z - 400);
  const direction = target.clone().sub(person.position);
  person.rotation.y = Math.atan2(direction.x, direction.z);
  const eyeAngle = Math.atan2(target.y - person.position.y - 1635, Math.hypot(direction.x, direction.z));
  oval('person-nose', 0, 1627 + 92 * Math.sin(eyeAngle), 92 * Math.cos(eyeAngle), 14, 18, 24, skin);
  oval('person-chin', 0, 1565, 57, 42, 26, 35, skin);
  for (const side of [-1, 1]) oval('person-eye', side * 33, 1650, 86, 8, 4, 5, hair);
  person.userData.lookTarget = target.toArray(); person.userData.groundY = ground.max.y;
  return person;
}
