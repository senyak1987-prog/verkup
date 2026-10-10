import * as THREE from 'three';
import { facadeRects, facadeSignPlacement, FACADE_SIGN_ANCHOR } from './signFacade';
import type { FacadeOptions, FacadeRect, SignPlacement } from './signFacade';
import { isPanelCornerMount, panelMountLayout } from './panelConstruction';
import type { PanelMountMode } from './panelConstruction';

type PanelFacadeMount = { mode: PanelMountMode; size: number; depth: number; gap: number; shape?: string; cornerRadius?: number };

const surfacePixels = new Map<string, Uint8Array>();
/** Tileable micro-relief, generated once; each facade owns its GPU textures. */
function surfaceTexture(kind: 'plaster' | 'roof' | 'wood') {
  const size = 512;
  let pixels = surfacePixels.get(kind);
  if (!pixels) {
    pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const noise = ((Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263)) >>> 0) % 7;
      const cloud = Math.sin(x * Math.PI / 128) * Math.cos(y * Math.PI / 128) * 3;
      const grain = kind === 'wood' ? Math.sin(x * Math.PI / 8 + Math.sin(y * Math.PI / 256) * 1.4) * 13
        + Math.sin(x * Math.PI / 2 + Math.sin(y * Math.PI / 128)) * 4 : 0;
      // Seams are physical geometry. High-contrast per-pixel roof bumps caused moire.
      const value = Math.round(kind === 'roof' ? 244 : 238 + noise + cloud + grain);
      const i = (y * size + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.min(255, value); pixels[i + 3] = 255;
    }
    surfacePixels.set(kind, pixels);
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter; texture.anisotropy = 2; texture.needsUpdate = true;
  return texture;
}

function architecturalOcclusion(rects: FacadeRect[]) {
  if (typeof document === 'undefined') return;
  const wall = rects.find(r => r.kind === 'wall')!;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 512, 512);
  // Soft contact shade is baked once, never evaluated as a screen-space effect.
  const shade = (x: number, y: number, w: number, h: number, blur: number) => {
    ctx.shadowColor = '#000000'; ctx.shadowBlur = blur; ctx.fillStyle = '#555555';
    ctx.fillRect(x, y, w, h);
  };
  shade(-20, -12, 552, 12, 22); shade(-20, 512, 552, 12, 28);
  for (const r of rects.filter(r => r.kind === 'opening'))
    shade((r.x - wall.x) / wall.w * 512, (r.y - wall.y) / wall.h * 512, r.w / wall.w * 512, r.h / wall.h * 512, 10);
  const texture = new THREE.CanvasTexture(canvas); texture.channel = 1;
  return texture;
}

/** Keep named architectural anchors for dimensions/collisions, render identical opaque parts in batches. */
export function batchFacadeDetails(group: THREE.Group) {
  const buckets = new Map<string, THREE.Mesh[]>();
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.material.transparent || mesh.material.userData.windowLight) continue;
    if (!['foliage', 'flower'].includes(mesh.userData.facadeKind) && !/-(frame|mullion)|wood-slat|architectural-|interior-(shelf|display|counter|pendant-wire)/.test(mesh.name)) continue;
    const key = mesh.geometry.uuid + mesh.material.uuid;
    const items = buckets.get(key) ?? []; items.push(mesh); buckets.set(key, items);
  }
  let saved = 0;
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const first = meshes[0], batch = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
    batch.name = 'facade-batch-' + first.name; batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow;
    batch.userData.facadeKind = first.userData.facadeKind;
    meshes.forEach((mesh, i) => { mesh.updateMatrix(); batch.setMatrixAt(i, mesh.matrix); mesh.visible = false; mesh.userData.batched = true; });
    batch.computeBoundingBox(); batch.computeBoundingSphere(); group.add(batch); saved += meshes.length - 1;
  }
  group.userData.savedDrawCalls = saved;
}

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
  const surface = ctx.getImageData(0, 0, 1000, 560);
  for (let y = 0; y < 560; y++) for (let x = 0; x < 1000; x++) {
    const n = (((Math.imul(x + 1, 73856093) ^ Math.imul(y + 7, 19349663)) >>> 0) % 13) - 6;
    const variation = n + Math.sin(x / 14) * Math.cos(y / 11) * 3;
    const i = (y * 1000 + x) * 4;
    for (let c = 0; c < 3; c++) surface.data[i + c] += variation;
  }
  ctx.putImageData(surface, 0, 0);
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
  const aoUv = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) { aoUv[i * 2] = (positions.getX(i) - left) / wall.w; aoUv[i * 2 + 1] = (positions.getY(i) - bottom) / wall.h; }
  geometry.setAttribute('uv1', new THREE.BufferAttribute(aoUv, 2));
  return geometry;
}

export function createFacadeModel(place: SignPlacement, _signWidth: number, _signHeight: number,
  options: FacadeOptions & { panelMount?: PanelFacadeMount; frontSign?: boolean; shell?: boolean; shellDepth?: number; openRight?: boolean } = {}, panelWallSurface = false) {
  const group = new THREE.Group(); group.name = 'facade';
  if (options.panelMount) {
    const panel = options.panelMount;
    group.userData.panelMountMode = panel.mode;
    const wallShift = 4 + (place === 'canopy' ? 1500 : 0);
    const corner = isPanelCornerMount(panel.mode);
    const front = createFacadeModel(place, _signWidth, _signHeight, { palette: options.palette, signBackMm: 0, shellDepth:corner?7800:5000, openRight:corner }, !options.frontSign);
    front.position.z = wallShift;
    if (isPanelCornerMount(panel.mode)) {
      front.name = 'facade-front'; front.position.x = -3900;
      const side = createFacadeModel(place, _signWidth, _signHeight, { palette: options.palette, signBackMm: 0, shell:false }, !options.frontSign);
      side.name = 'facade-side'; side.rotation.y = Math.PI / 2;
      side.position.set(wallShift, 0, -3900);
      const offset = front.userData.windowCount ?? 0;
      side.traverse(child => {
        if(child instanceof THREE.Light && child.userData.windowIntensity)child.userData.windowIndex+=offset;
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
  const plaster = masonry ? undefined : surfaceTexture('plaster');
  const facadeTimber = palette === 'scandi' || dayRects.some(r=>r.name?.includes('wood-slat')) ? surfaceTexture('wood') : undefined;
  const occlusion = architecturalOcclusion(dayRects);
  group.userData.palette = palette; group.userData.signMountZ = anchorZ;
  group.userData.signAnchor = { x: anchorX, y: anchorY };
  group.userData.signFitsSurface = placement.fits;
  group.userData.signMountSurface = place === 'canopy' && !panelWallSurface ? 'canopy-frieze' : 'wall';
  let windowCount = 0;

  for (const [index, r] of dayRects.entries()) {
    const kind = r.kind ?? 'detail';
    const timberDetail = r.name?.includes('wood-slat') || r.name === 'scandi-canopy-soffit' ||
      palette === 'scandi' && ['sign-mounting-band', 'canopy-fascia'].includes(r.name ?? '');
    const windowIndex = kind === 'glass' ? windowCount++ : undefined;
    const materialKey = kind + ':' + (kind === 'glass' ? r.name : r.color) + (timberDetail ? ':timber' : '');
    let material = materials.get(materialKey);
    if (!material) {
      material = kind === 'glass'
        ? new THREE.MeshPhysicalMaterial({ color: '#b9cecd', roughness: .22, metalness: 0,
          // Alpha glazing keeps the furnished room visible without a full-scene refraction pass.
          ior: 1.45, transmission: 0, thickness: 80, attenuationColor: '#d8d3c5', attenuationDistance: 1800,
          clearcoat: .3, clearcoatRoughness: .28, specularIntensity: .65, envMapIntensity: .85, transparent: true, opacity: .28, depthWrite: false, side: THREE.FrontSide })
        : new THREE.MeshStandardMaterial({ color: r.color,
          roughness: kind === 'foliage' ? .86 : kind === 'wall' ? .98 : .77,
          metalness: r.name?.includes('frame') || r.name?.includes('canopy') ? .12 : 0, envMapIntensity: .3 });
      material.userData.dayColor = material.color.clone();
      material.userData.nightColor = new THREE.Color(nightRects[index].color);
      if (timberDetail && facadeTimber) {
        material.map = material.bumpMap = material.roughnessMap = facadeTimber;
        material.bumpScale = .65; material.roughness = .8;
      }
      // Interior light remains independent of the sign's lighting switch.
      if (kind === 'glass') {
        material.emissive.set('#ffd8a1');
        material.userData.maxWindowEmission = .025;
        material.userData.maxEmission = material.userData.maxWindowEmission;
        material.userData.facadeEmission = true;
        material.userData.windowLight = true; material.userData.windowIndex = windowIndex;
        material.userData.nightColor = new THREE.Color('#bcb8ad');
        material.userData.dayEnvIntensity = .85; material.userData.nightEnvIntensity = .3;
        material.userData.frostedGlass = false;
      }
      if (kind === 'lamp') { material.emissive.set(nightRects[index].color); material.userData.maxEmission = .65; material.userData.facadeEmission = true; }
      if (kind === 'wall' && masonry) {
        material.color.set('#ffffff'); material.userData.dayColor = material.color.clone();
        material.userData.nightColor = material.color.clone().multiplyScalar(.58);
        material.map = masonry.color; material.bumpMap = masonry.bump; material.bumpScale = 1.3;
      }
      if (kind === 'wall') {
        if (plaster) { material.map = plaster; material.bumpMap = plaster; material.roughnessMap = plaster; material.bumpScale = .8; }
        if (masonry) material.roughnessMap = masonry.bump;
        if (occlusion) { material.aoMap = occlusion; material.aoMapIntensity = .7; }
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
    // An opaque cap 65 mm behind the glass used to hide the room.
    if(kind==='opening') {mesh.position.z=anchorZ+(r.z??0)-2450;material.color.set('#bdb4a4');material.userData.dayColor=material.color.clone();}
    mesh.receiveShadow = kind !== 'lamp';
    mesh.castShadow = kind !== 'glass' && kind !== 'opening' && kind !== 'lamp';
    mesh.userData.facadeKind = kind;
    mesh.userData.frontZ = anchorZ + (r.z ?? 0);
    if (windowIndex !== undefined) mesh.userData.windowIndex = windowIndex;
    group.add(mesh);
  }
  addBuildingInterior(group,dayRects,{x:anchorX,y:anchorY,z:anchorZ},options,boxGeometry);
  addArchitecturalFinish(group, dayRects, {x:anchorX,y:anchorY,z:anchorZ}, options, boxGeometry);
  batchFacadeDetails(group);
  group.userData.windowCount = windowCount;
  return group;
}

/** Four physical walls, a pitched roof, and a furnished shop behind real glazing apertures. */
function addBuildingInterior(group:THREE.Group,rects:FacadeRect[],anchor:{x:number;y:number;z:number},
  options:{shell?:boolean;shellDepth?:number;openRight?:boolean;palette?:FacadeOptions['palette']},boxGeometry:THREE.BoxGeometry){
  const wall=rects.find(r=>r.kind==='wall')!,frontZ=anchor.z+(wall.z??0),depth=options.shellDepth??5000;
  const left=wall.x-anchor.x,right=left+wall.w,top=anchor.y-wall.y,bottom=top-wall.h;
  const materialCache = new Map<string, THREE.MeshStandardMaterial>();
  const material=(color:string,roughness=.8)=>{const key=color+':'+roughness; const cached=materialCache.get(key);if(cached)return cached;
    const m=new THREE.MeshStandardMaterial({color,roughness});m.userData.dayColor=m.color.clone();materialCache.set(key,m);return m;};
  const stone=material(wall.color),floor=material('#9e8b71'),wood=material('#a87b50'),dark=material('#40494d'),cream=material('#ded3bf');
  const plaster = surfaceTexture('plaster'), timber = surfaceTexture('wood');
  plaster.repeat.set(3, 2); timber.repeat.set(3, 1);
  stone.map = stone.bumpMap = stone.roughnessMap = plaster; stone.bumpScale = .8;
  const shellMasonry = options.palette === 'brick' ? masonryTexture() : undefined;
  if (shellMasonry) {
    stone.map = shellMasonry.color; stone.bumpMap = stone.roughnessMap = shellMasonry.bump;
    stone.bumpScale = 1.3; stone.color.set('#ffffff'); stone.userData.dayColor = stone.color.clone();
    plaster.dispose();
  }
  wood.map = wood.bumpMap = wood.roughnessMap = timber; wood.bumpScale = .5;
  const add=(name:string,w:number,h:number,d:number,x:number,y:number,z:number,m:THREE.MeshStandardMaterial)=>{
    const mesh=new THREE.Mesh(boxGeometry,m);mesh.name=name;mesh.scale.set(w,h,d);mesh.position.set(x,y,z);
    if (m === stone) {
      mesh.geometry = boxGeometry.clone();
      const p = mesh.geometry.attributes.position, normal = mesh.geometry.attributes.normal, uv = mesh.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i,
        (Math.abs(normal.getX(i)) > .5 ? p.getZ(i) * d : p.getX(i) * w) / 3000,
        (Math.abs(normal.getY(i)) > .5 ? p.getZ(i) * d : p.getY(i) * h) / 1680);
    }
    if (name.startsWith('interior-') && !m.userData.windowLight) {
      m.emissive.copy(m.color); m.userData.interiorAmbient = .075;
    }
    mesh.castShadow=mesh.receiveShadow=true;mesh.userData.facadeKind='interior';group.add(mesh);return mesh;
  };
  if(options.shell!==false){
    add('building-left-wall',200,wall.h,depth,left+100,(top+bottom)/2,frontZ-depth/2,stone);
    if(!options.openRight)add('building-right-wall',200,wall.h,depth,right-100,(top+bottom)/2,frontZ-depth/2,stone);
    add('building-back-wall',wall.w,wall.h,200,(left+right)/2,(top+bottom)/2,frontZ-depth+100,stone);
    add('interior-floor',wall.w-400,70,depth-400,(left+right)/2,bottom+485,frontZ-depth/2,floor);
    add('interior-ceiling',wall.w-400,80,depth-400,(left+right)/2,top-100,frontZ-depth/2,cream);
    const roof=material(options.palette === 'scandi' ? '#46504b' : '#4c5255',.58),rise=1050,half=depth/2+220,roofSlope=Math.hypot(half,rise);
    const roofTexture = surfaceTexture('roof'); roofTexture.repeat.set(4, 2);
    roof.map = roof.roughnessMap = roofTexture;
    for(const direction of [-1,1]){
      const mesh=add('building-roof-'+(direction===1?'rear':'front'),wall.w+400,60,roofSlope,
        (left+right)/2,top+rise/2+45,frontZ-depth/2+direction*half/2,roof);
      mesh.rotation.x=direction*Math.atan2(rise,half);
      for (let x = left - 160; x <= right + 160; x += 520) {
        const seam = add('architectural-roof-seam',18,32,roofSlope,x,mesh.position.y,mesh.position.z,roof);
        seam.rotation.copy(mesh.rotation);
        seam.position.add(new THREE.Vector3(0,46,0).applyEuler(mesh.rotation));
      }
      for (const x of [left-205,right+205]) {
        const edge = add('architectural-roof-verge',32,110,roofSlope+40,x,mesh.position.y,mesh.position.z,roof);
        edge.rotation.copy(mesh.rotation);
      }
    }
    add('architectural-roof-ridge',wall.w+450,60,130,(left+right)/2,top+rise+80,frontZ-depth/2,roof);
    for (const edgeZ of [frontZ+170,frontZ-depth-170])
      add('architectural-eaves-fascia',wall.w+400,150,110,(left+right)/2,top+25,edgeZ,roof);
    const shape=new THREE.Shape();shape.moveTo(-depth/2,0);shape.lineTo(depth/2,0);shape.lineTo(0,rise);shape.closePath();
    for(const x of [left+100,right-100]){
      const geometry=new THREE.ExtrudeGeometry(shape,{depth:200,bevelEnabled:false});geometry.rotateY(Math.PI/2);
      const positions=geometry.attributes.position, uv=geometry.attributes.uv;
      for(let i=0;i<uv.count;i++)uv.setXY(i,(positions.getZ(i)+depth/2)/3000,positions.getY(i)/1680);
      const mesh=new THREE.Mesh(geometry,stone);mesh.position.set(x-100,top,frontZ-depth/2);mesh.name='building-roof-gable';mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
    }
    group.userData.buildingDepthMm=depth;group.userData.closedBuilding=true;
    const base = material('#666b67');
    add('architectural-left-plinth',225,220,depth,left+100,bottom+110,frontZ-depth/2,base);
    if (!options.openRight) {
      add('architectural-right-plinth',225,220,depth,right-100,bottom+110,frontZ-depth/2,base);
    }
  }
  for(const [index,r]of rects.filter(r=>r.kind==='glass').entries()){
    const cx=r.x+r.w/2-anchor.x,base=anchor.y-r.y-r.h,behind=frontZ-1050;
    if(!r.name?.startsWith('door')){
      add('interior-counter-'+index,r.w*.75,650,520,cx,base+325,behind,wood);
      add('interior-counter-top-'+index,r.w*.8,35,570,cx,base+665,behind,cream);
      for(const level of [0,1,2]){
        add('interior-shelf-'+index+'-'+level,r.w*.78,35,300,cx,base+950+level*320,frontZ-2150,dark);
        for(let item=0;item<4;item++){
          const color=['#aa624a','#b9a064','#789278','#b7a89b'][(item+level)%4],product=material(color);
          add('interior-display-'+index+'-'+level+'-'+item,95,145+item%2*45,115,cx+(item-1.5)*r.w*.16,base+1040+level*320,frontZ-2080,product);
        }
      }
    }
    const lamp=material('#f2ddae').clone();lamp.emissive.set('#ffe0a0');
    lamp.userData.windowLight=true;lamp.userData.windowIndex=index;lamp.userData.facadeEmission=true;lamp.userData.maxWindowEmission=1.8;lamp.userData.dayWindowEmission=.18;
    const pendant = new THREE.Mesh(new THREE.ConeGeometry(140,150,16,1,true),dark);
    pendant.name='interior-pendant-shade-'+index;pendant.position.set(cx,anchor.y-r.y-200,behind);pendant.castShadow=true;group.add(pendant);
    add('interior-pendant-'+index,125,24,125,cx,anchor.y-r.y-265,behind,lamp);
    add('interior-pendant-wire-'+index,8,600,8,cx,anchor.y-r.y+160,behind,dark);
    const light=new THREE.PointLight('#ffd6a0',0,2600,2);light.name='interior-light-'+index;
    light.position.set(cx,base+r.h*.75,frontZ-950);light.userData.windowIndex=index;light.userData.windowIntensity=1000000;light.userData.dayWindowIntensity=.4;group.add(light);
    addWindowSpill(group, r, index, anchor, frontZ);
  }
}

/** Small, instanced construction details and planted displays give the realtime house its scale. */
function addArchitecturalFinish(group: THREE.Group, rects: FacadeRect[], anchor: {x:number;y:number;z:number},
  options: {shell?:boolean;shellDepth?:number;openRight?:boolean;palette?:FacadeOptions['palette']}, box: THREE.BoxGeometry) {
  const wall = rects.find(r=>r.kind==='wall')!, z = anchor.z+(wall.z??0);
  const left = wall.x-anchor.x, right = left+wall.w, top=anchor.y-wall.y, floor=top-wall.h;
  const material=(color:string,roughness=.75)=>{
    const m=new THREE.MeshStandardMaterial({color,roughness});m.userData.dayColor=m.color.clone();return m;
  };
  const metal=material(options.palette==='scandi'?'#35453f':'#41494b',.48), rubber=material('#202a29');
  const leafGeo=new THREE.SphereGeometry(.5,6,4), budGeo=new THREE.IcosahedronGeometry(.5,0);
  const potGeo=new THREE.CylinderGeometry(.42,.32,1,10), pipeGeo=new THREE.CylinderGeometry(.5,.5,1,12);
  const leaves=['#425f38','#597544','#7b8d55'].map(c=>material(c,.9));
  const flowers=['#e5dbc3','#b99a70','#cfb6b0'].map(c=>material(c));
  const ceramic=material('#b4a18a'), soil=material('#3e382e');
  const place=(name:string,geometry:THREE.BufferGeometry,m:THREE.MeshStandardMaterial,
    x:number,y:number,pz:number,w:number,h:number,d:number,kind='detail')=>{
    const mesh=new THREE.Mesh(geometry,m);mesh.name='architectural-'+name;mesh.position.set(x,y,pz);mesh.scale.set(w,h,d);
    mesh.userData.facadeKind=kind;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);return mesh;
  };
  if(options.shell!==false){
    const depth=options.shellDepth??5000;
    for(const gz of [z+235,z-depth-235]){
      const gutter=place('gutter',pipeGeo,metal,(left+right)/2,top+4,gz,110,wall.w+430,110);
      gutter.rotation.z=Math.PI/2;
    }
    if(!options.openRight){
      place('downpipe',pipeGeo,metal,right-55,floor+wall.h/2,z+90,85,wall.h-100,85);
      for(const py of [floor+350,floor+1800,top-300])place('pipe-bracket',box,metal,right-55,py,z+80,120,28,115);
      const outlet=place('pipe-elbow',pipeGeo,metal,right-55,floor+110,z+140,85,210,85);outlet.rotation.x=-Math.PI/3;
    }
  }
  for(const r of rects.filter(r=>r.kind==='glass')){
    const cx=r.x+r.w/2-anchor.x, cy=anchor.y-r.y-r.h/2, pz=anchor.z+(r.z??0)+7;
    // Thin inner seals and side reveals remain outside the clear glazing aperture.
    for(const x of [cx-r.w/2-5,cx+r.w/2+5])place('window-seal',box,rubber,x,cy,pz,10,r.h+20,12);
    for(const y of [cy-r.h/2-5,cy+r.h/2+5])place('window-seal',box,rubber,cx,y,pz,r.w+20,10,12);
    if(r.name?.startsWith('door'))continue;
    const bottom=cy-r.h/2;
    for(let k=0;k<3;k++){
      const px=cx+(k-1)*r.w*.25, py=bottom+665, pz=z-880;
      place('display-pot',potGeo,ceramic,px,py+95,pz,180,190,180);
      place('pot-soil',pipeGeo,soil,px,py+189,pz,145,8,145);
      for(let i=0;i<18;i++){
        const angle=i*2.399, radius=45+(i%4)*22, height=py+230+(i%7)*32;
        const leaf=place('display-leaf',leafGeo,leaves[i%3],px+Math.cos(angle)*radius,height,pz+Math.sin(angle)*radius,110,35,58,'foliage');
        leaf.rotation.set(.3*Math.sin(angle),angle,.3*Math.cos(angle));
      }
      for(let i=0;i<5;i++)place('display-flower',budGeo,flowers[k%3],px+Math.cos(i*2.4)*65,py+450+(i%2)*40,pz+Math.sin(i*2.4)*65,65,60,65,'flower');
    }
  }
  for(const r of rects.filter(r=>r.name==='planter-box')){
    const cx=r.x+r.w/2-anchor.x, cy=anchor.y-r.y, pz=anchor.z+(r.z??0)-(r.depth??0)/2;
    for(let i=0;i<90;i++){
      const angle=i*2.399, radius=40+(i%9)*18, height=70+(i%11)*36;
      const leaf=place('planter-leaf',leafGeo,leaves[i%3],cx+Math.cos(angle)*radius,cy+height,pz+Math.sin(angle)*radius,100,38,64,'foliage');
      leaf.rotation.set(.5*Math.cos(angle),angle,.45*Math.sin(angle));
    }
    for(let i=0;i<18;i++)place('planter-blossom',budGeo,flowers[i%3],cx+Math.cos(i*2.4)*160,cy+250+(i%5)*35,pz+Math.sin(i*2.4)*160,42,40,42,'flower');
  }
}

/** A soft aperture light reaches the pavement and nearby objects without a visible cone. */
function addWindowSpill(group: THREE.Group, pane: FacadeRect, index: number,
  anchor: {x:number;y:number;z:number}, frontZ:number) {
  const x=pane.x+pane.w/2-anchor.x, groundY=anchor.y-3990;
  const light=new THREE.SpotLight('#ffd6a0',0,4400,.72,1,2);
  light.name='window-exterior-light-'+index;
  light.position.set(x,anchor.y-pane.y-pane.h*.45,frontZ+30);
  light.target.position.set(x,groundY,frontZ+1450);
  light.userData.windowIndex=index;light.userData.windowIntensity=2400000;light.userData.dayWindowIntensity=0;
  group.add(light,light.target);
  // Analytic soft penumbra stays smooth at every zoom; no texture or additional shadow maps.
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
    blending:THREE.AdditiveBlending,uniforms:{strength:{value:0},spillColor:{value:new THREE.Color('#ffd39a')}},
    vertexShader:'varying vec2 spillUv; void main(){spillUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`varying vec2 spillUv; uniform float strength; uniform vec3 spillColor;
      void main(){float side=1.0-smoothstep(.35,1.0,abs(spillUv.x*2.0-1.0));
      float reach=1.0-smoothstep(.05,1.0,1.0-spillUv.y);
      gl_FragColor=vec4(spillColor,side*reach*reach*strength);
      #include <colorspace_fragment>
      }`});
  material.userData.windowLight=true;material.userData.windowIndex=index;material.userData.maxWindowSpill=.42;
  const spill=new THREE.Mesh(new THREE.PlaneGeometry(pane.w*1.55,2200),material);
  spill.name='window-pavement-light-'+index;spill.rotation.x=-Math.PI/2;
  spill.position.set(x,groundY+1.5,frontZ+1150);spill.renderOrder=2;group.add(spill);
}

/** A cropped wall sample makes the same anchoring visible when no architectural scene is selected. */
export function createPanelMountContext(panel: PanelFacadeMount, palette: FacadeOptions['palette'] = 'stone') {
  const group = new THREE.Group(); group.name = 'panel-mount-context';
  const span = Math.max(750, panel.size * 1.2), height = Math.max(700, panel.size * 1.4), thickness = 90;
  const colors = { stone: '#d8d2c8', brick: '#bc8062', charcoal: '#68747d', scandi: '#e7e1d3' };
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

/** Bake the brand into the fabric itself: one surface, without an intersecting decal. */
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
  const cloth=document.createElement('canvas');cloth.width=1024;cloth.height=2048;
  const fabric=cloth.getContext('2d')!;fabric.fillStyle='#164d3d';fabric.fillRect(0,0,1024,2048);
  fabric.drawImage(canvas,164,492,696,532);
  const print = new THREE.CanvasTexture(cloth); print.colorSpace = THREE.SRGBColorSpace;
  print.anisotropy = 4; return print;
}

/** A pinned collar and restrained wind, shared by every point of the printed cloth. */
function capePoint(u:number,v:number,time=0) {
  const width=THREE.MathUtils.lerp(195,330,v),x=(u-.5)*width*2;
  const wind=v*v*(30*Math.sin(time*1.45-v*3.2+u*2)+12*Math.sin(time*.93+u*5));
  const y=1475-v*1145-12*Math.sin(Math.PI*u)*v;
  const z=-165-145*v-18*Math.cos((u-.5)*Math.PI*6)*Math.sin(Math.PI*v/2)-24*Math.sin(Math.PI*v)+wind;
  return new THREE.Vector3(x+v*v*12*Math.sin(time*.95),y+v*v*4*Math.sin(time*1.45+u*2),z);
}

function addStandingMotion(material:THREE.MeshStandardMaterial,time:{value:number}) {
  material.onBeforeCompile=shader=>{
    shader.uniforms.personTime=time;
    shader.vertexShader='uniform float personTime;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      float upper = smoothstep(650.0, 1380.0, position.y);
      float chest = sin(clamp((position.y-800.0)/700.0,0.0,1.0)*3.14159265);
      transformed.x += upper * 1.7 * sin(personTime * 0.72);
      transformed.y += upper * 0.8 * sin(personTime * 1.35);
      transformed.z += chest * 1.5 * sin(personTime * 1.35);
    `);
  };
  material.customProgramCacheKey=()=> 'gorod-svet-standing-v2';
}

/** Smooth regional articulation for the static source mesh, baked before normals/shadows. */
function relaxedStandingPoint(x:number,y:number,z:number,headPitch:number) {
  const smooth=(a:number,b:number,v:number)=>THREE.MathUtils.smoothstep(v,a,b);
  const leg=1-smooth(650,920,y),free=x<0;
  const shift=smooth(650,1100,y)*35;
  const arm=smooth(165,225,Math.abs(x))*(1-smooth(1320,1460,y))*smooth(570,690,y);
  let px=x+shift+(free?-32:8)*leg-arm*Math.sign(x)*(free?36:14);
  let pz=z+(free?85:-16)*leg+(free?70:0)*Math.sin(Math.PI*Math.min(1,y/920))*leg+arm*(free?85:25);
  // Relax the free foot outward, while both soles stay on the same ground plane.
  const foot=1-smooth(110,230,y),yaw=(free?-.10:.035)*foot;
  const centre=free?-115:115,dx=px-centre,dz=pz-35;
  px=centre+Math.cos(yaw)*dx+Math.sin(yaw)*dz;
  pz=35-Math.sin(yaw)*dx+Math.cos(yaw)*dz;
  const head=smooth(1440,1510,y),angle=-headPitch*head,dy=y-1460;
  return new THREE.Vector3(px,1460+Math.cos(angle)*dy-Math.sin(angle)*pz,
    Math.sin(angle)*dy+Math.cos(angle)*pz);
}

/** Ready-made Quaternius superhero with authored parted hair, at an exact 1750 mm scale. */
export function createScalePerson(facade: THREE.Group, target: THREE.Vector3, brand?: THREE.Texture, asset?: THREE.Group) {
  const pavement=facade.getObjectByName('facade-pavement');if(!pavement || !asset)return null;
  facade.updateWorldMatrix(true,true);const ground=new THREE.Box3().setFromObject(pavement);
  const person=new THREE.Group();person.name='scale-person';person.userData.heightMm=SCALE_PERSON_HEIGHT_MM;
  person.userData.assetSource='Quaternius Universal Base Characters / Superhero Male';person.userData.assetLicense='CC0 1.0';
  person.position.set(THREE.MathUtils.clamp(target.x-1800,ground.min.x+500,ground.max.x-500),ground.max.y,ground.max.z-650);
  const direction=target.clone().sub(person.position);person.rotation.y=Math.atan2(direction.x,direction.z);
  const headPitch=THREE.MathUtils.clamp(Math.atan2(direction.y-1580,Math.hypot(direction.x,direction.z)),.10,.32);
  person.userData.standingPose='relaxed-weight-shift';person.userData.headPitchRadians=headPitch;
  const time={value:0};person.userData.motionTime=time;
  const body=asset.clone(true);body.name='quaternius-superhero';
  body.traverse(child=>{const mesh=child as THREE.Mesh;if(!mesh.isMesh)return;
    mesh.geometry=mesh.geometry.clone();
    const vertices=mesh.geometry.getAttribute('position');
    for(let i=0;i<vertices.count;i++){
      const point=relaxedStandingPoint(vertices.getX(i),vertices.getY(i),vertices.getZ(i),headPitch);
      vertices.setXYZ(i,point.x,point.y,point.z);
    }
    mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();
    const copy=(original:THREE.Material)=>{const material=original.clone() as THREE.MeshStandardMaterial;
      material.userData.dayColor=material.color.clone();material.roughness=.72;material.metalness=0;material.envMapIntensity=.35;
      addStandingMotion(material,time);return material;};
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(copy):copy(mesh.material);
    mesh.castShadow=mesh.receiveShadow=true;
  });person.add(body);
  const bodyBounds=new THREE.Box3().setFromObject(body),poseScale=SCALE_PERSON_HEIGHT_MM/bodyBounds.getSize(new THREE.Vector3()).y;
  person.userData.poseScale=poseScale;
  body.traverse(child=>{const mesh=child as THREE.Mesh;if(!mesh.isMesh)return;mesh.geometry.scale(poseScale,poseScale,poseScale);});
  const geometry=new THREE.PlaneGeometry(1,1,64,80),positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  for(let i=0;i<positions.count;i++){
    const u=uv.getX(i),v=1-uv.getY(i),point=capePoint(u,v);
    const shift=THREE.MathUtils.smoothstep(point.y,650,1100)*35;
    positions.setXYZ(i,(point.x+shift)*poseScale,point.y*poseScale,point.z*poseScale);
    // The print is readable from behind. UVs stay attached during wind deformation.
    uv.setX(i,1-u);
  }
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const capeMaterial=new THREE.MeshStandardMaterial({map:brand??null,color:brand?'#ffffff':'#164d3d',roughness:.94,metalness:0,
    side:THREE.DoubleSide,envMapIntensity:.3});
  capeMaterial.userData.dayColor=capeMaterial.color.clone();
  addStandingMotion(capeMaterial,time);
  const cape=new THREE.Mesh(geometry,capeMaterial);cape.name='person-cape';cape.userData.brand='Город Свет';
  cape.castShadow=cape.receiveShadow=true;person.add(cape);
  person.userData.lookTarget=target.toArray();person.userData.groundY=ground.max.y;return person;
}

/** Feet and placement stay fixed; only upper-body breathing and the free cloth move. */
export function animateScalePerson(person:THREE.Object3D,timeSeconds:number,reducedMotion=false) {
  const time=person.userData.motionTime as {value:number}|undefined;
  const cape=person.getObjectByName('person-cape') as THREE.Mesh|undefined;
  if(!time||!cape)return false;
  const phase=reducedMotion?0:timeSeconds;time.value=phase;
  const positions=cape.geometry.getAttribute('position'),uv=cape.geometry.getAttribute('uv');
  for(let i=0;i<positions.count;i++){
    const point=capePoint(1-uv.getX(i),1-uv.getY(i),phase);
    const scale=person.userData.poseScale??1,shift=THREE.MathUtils.smoothstep(point.y,650,1100)*35;
    positions.setXYZ(i,(point.x+shift)*scale,point.y*scale,point.z*scale);
  }
  positions.needsUpdate=true;cape.geometry.computeVertexNormals();
  // Bounded wind fits inside this sphere for all phases, avoiding per-frame camera fitting.
  cape.geometry.boundingSphere!.radius=750;
  return !reducedMotion&&person.visible;
}
