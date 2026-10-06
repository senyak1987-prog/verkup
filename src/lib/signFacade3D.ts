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
  // Crop the official wordmark before its small advertising tagline.
  ctx.drawImage(wordmark, 0, 0, 420, 84, 12, 290, 1000, 200);
  // The official lettering printed in light ink remains readable on green fabric.
  ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#f4efe4'; ctx.fillRect(0, 0, 1024, 512);
  ctx.globalCompositeOperation = 'source-over'; draw(bulb, 380, 12, 264, 280);
  textures.forEach(texture => texture.dispose());
  const print = new THREE.CanvasTexture(canvas); print.colorSpace = THREE.SRGBColorSpace;
  print.anisotropy = 4; return print;
}

/** Ready-made Quaternius superhero, with an original flowing cape, at an exact 1750 mm scale. */
export function createScalePerson(facade: THREE.Group, target: THREE.Vector3, brand?: THREE.Texture, asset?: THREE.Group) {
  const pavement=facade.getObjectByName('facade-pavement');if(!pavement || !asset)return null;
  facade.updateWorldMatrix(true,true);const ground=new THREE.Box3().setFromObject(pavement);
  const person=new THREE.Group();person.name='scale-person';person.userData.heightMm=SCALE_PERSON_HEIGHT_MM;
  person.userData.assetSource='Quaternius Universal Base Characters / Superhero Male';person.userData.assetLicense='CC0 1.0';
  const body=asset.clone(true);body.name='quaternius-superhero';
  body.traverse(child=>{const mesh=child as THREE.Mesh;if(!mesh.isMesh)return;
    mesh.geometry=mesh.geometry.clone();
    const copy=(original:THREE.Material)=>{const material=original.clone() as THREE.MeshStandardMaterial;
      material.userData.dayColor=material.color.clone();material.roughness=.72;material.metalness=0;material.envMapIntensity=.35;return material;};
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(copy):copy(mesh.material);
    mesh.castShadow=mesh.receiveShadow=true;
  });person.add(body);
  const capePoint=(u:number,v:number)=>{
    const width=THREE.MathUtils.lerp(195,350,v),x=(u-.5)*width*2;
    const y=1490-v*1160-12*Math.sin(Math.PI*u)*v;
    const z=-108-150*v-24*Math.cos((u-.5)*Math.PI*6)*Math.sin(Math.PI*v/2)-28*Math.sin(Math.PI*v);
    return new THREE.Vector3(x,y,z);
  };
  const clothGeometry=(print:boolean)=>{
    const geometry=new THREE.PlaneGeometry(1,1,64,80),positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
    for(let i=0;i<positions.count;i++){
      const u=uv.getX(i),v=1-uv.getY(i);
      // Reversing U makes the print readable from behind the wearer.
      const point=print?capePoint(.16+(1-u)*.68,.24+v*.26):capePoint(u,v);
      positions.setXYZ(i,point.x,point.y,point.z-(print?1:0));
    }geometry.computeVertexNormals();return geometry;
  };
  const capeMaterial=new THREE.MeshStandardMaterial({color:'#164d3d',roughness:.9,metalness:0,side:THREE.DoubleSide,envMapIntensity:.3});
  capeMaterial.userData.dayColor=capeMaterial.color.clone();
  const cape=new THREE.Mesh(clothGeometry(false),capeMaterial);cape.name='person-cape';cape.castShadow=cape.receiveShadow=true;person.add(cape);
  const printMaterial=new THREE.MeshStandardMaterial({map:brand??null,color:'#ffffff',transparent:true,alphaTest:.04,roughness:.95,
    metalness:0,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1});
  printMaterial.userData.dayColor=printMaterial.color.clone();printMaterial.userData.textileBrand=true;
  const print=new THREE.Mesh(clothGeometry(true),printMaterial);print.name='person-gorod-svet-cape';print.userData.brand='Город Свет';
  print.visible=Boolean(brand);print.castShadow=false;print.receiveShadow=true;person.add(print);
  person.position.set(THREE.MathUtils.clamp(target.x+1100,ground.min.x+400,ground.max.x-400),ground.max.y,ground.max.z-600);
  const direction=target.clone().sub(person.position);person.rotation.y=Math.atan2(direction.x,direction.z);
  person.userData.lookTarget=target.toArray();person.userData.groundY=ground.max.y;return person;
}
