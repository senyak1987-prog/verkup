export const SIGN_PLACEMENTS = [
  { id: 'none', title: 'Без фасада' },
  { id: 'windows', title: 'Над окнами' },
  { id: 'shop', title: 'Над витриной' },
  { id: 'canopy', title: 'На козырьке' },
  { id: 'entrance', title: 'У входа' },
] as const;
export type SignPlacement = typeof SIGN_PLACEMENTS[number]['id'];
export const FACADE_PALETTES = [
  { id: 'stone', title: 'Светлый камень' },
  { id: 'brick', title: 'Тёплый кирпич' },
  { id: 'charcoal', title: 'Графит и дерево' },
] as const;
export type FacadePalette = typeof FACADE_PALETTES[number]['id'];
export const FACADE_SIGN_ANCHOR = { x: 3900, y: 800 } as const;
export const FACADE_VIEWBOX = { x: 0, y: 0, width: 7800, height: 4050 } as const;
export type FacadeSignBox = { x: number; y: number; width: number; height: number };
export type FacadeOptions = { palette?: FacadePalette; signBackMm?: number; signBox?: FacadeSignBox; panelMount?: ReturnType<typeof panelMountLayout> };
export type FacadeRect = {
  x: number; y: number; w: number; h: number; color: string;
  /** Millimetres. Front surface relative to the sign mounting surface. */
  z?: number; depth?: number; kind?: 'wall' | 'opening' | 'glass' | 'foliage' | 'flower' | 'lamp';
  name?: string; rotation?: number; radius?: number;
};

export const FACADE_COLORS = {
  stone: { wall: '#ddd7cd', joint: '#c8c0b4', trim: '#e8e1d7', frame: '#39444a', glass: '#5d7781', fascia: '#444c50', wood: '#a58261', ground: '#b3ada4', planter: '#877366' },
  brick: { wall: '#bc8062', joint: '#ab9580', trim: '#d7c7b5', frame: '#303b43', glass: '#526d7b', fascia: '#39444d', wood: '#a87d57', ground: '#ada59b', planter: '#725348' },
  charcoal: { wall: '#757e85', joint: '#657078', trim: '#b9b6ad', frame: '#28333e', glass: '#587486', fascia: '#303c46', wood: '#b59a77', ground: '#a9aaa5', planter: '#655f59' },
} as const;

function nightColor(hex: string, night: boolean, amount = .58) {
  if (!night) return hex;
  return '#' + hex.slice(1).match(/../g)!.map(part => Math.round(parseInt(part, 16) * amount).toString(16).padStart(2, '0')).join('');
}

/** One architectural description supplies the SVG and the 3D model. No coplanar glass/frame surfaces. */
export function facadeRects(place: SignPlacement, night: boolean, options: FacadeOptions = {}): FacadeRect[] {
  const palette = options.palette ?? 'stone', c = FACADE_COLORS[palette];
  const wallZ = place === 'canopy' ? -1500 : 0;
  const rects: FacadeRect[] = [];
  const add = (x: number, y: number, w: number, h: number, color: string, z = wallZ + 8, depth = 8,
    name = 'detail', extra: Partial<FacadeRect> = {}) => rects.push({ x, y, w, h, color: nightColor(color, night), z, depth, name, ...extra });
  add(0, 0, 7800, 3990, c.wall, wallZ, 200, 'wall', { kind: 'wall' });
  add(0, 0, 7800, 100, c.trim, wallZ + 25, 45, 'cornice');
  add(0, 100, 7800, 15, c.joint, wallZ + 8, 12, 'cornice-shadow');
  add(0, 3860, 7800, 130, c.trim, wallZ + 20, 45, 'plinth');
  add(0, 3990, 7800, 60, c.ground, wallZ + 2400, 2650, 'pavement');

  if (palette === 'stone') {
    for (const y of [450, 1350, 3780]) add(0, y, 7800, 8, c.joint, wallZ + 2, 3, 'stone-course');
    for (const [x, y, h] of [[1800, 120, 330], [6000, 120, 330], [240, 460, 890], [7540, 460, 890]]) add(x, y, 8, h, c.joint, wallZ + 2, 3, 'stone-joint');
  } else if (palette === 'charcoal') {
    for (let x = 300; x < 7800; x += 900) add(x, 120, 8, 1220, c.joint, wallZ + 2, 3, 'cladding-joint');
  }

  const window = (x: number, y: number, w: number, h: number, divided: boolean, door = false) => {
    const id = door ? 'door' : 'window-' + x;
    // Back of the opening, glazing, frame and stone trim have distinct depths.
    add(x, y, w, h, '#293942', wallZ - 130, 12, id + '-opening', { kind: 'opening' });
    add(x + 45, y + 45, w - 90, h - 90, night ? '#dcc294' : c.glass, wallZ - 65, 10, id + '-glass', { kind: 'glass', color: night ? '#dcc294' : c.glass });
    for (const [bx, by, bw, bh] of [[x - 50, y - 50, w + 100, 50], [x - 50, y + h, w + 100, 50], [x - 50, y, 50, h], [x + w, y, 50, h]])
      add(bx, by, bw, bh, c.trim, wallZ + 25, 90, id + '-stone-reveal');
    for (const [bx, by, bw, bh] of [[x, y, w, 45], [x, y + h - 45, w, 45], [x, y + 45, 45, h - 90], [x + w - 45, y + 45, 45, h - 90]])
      add(bx, by, bw, bh, c.frame, wallZ + 15, 80, id + '-frame');
    if (divided) {
      add(x + w / 2 - 18, y + 45, 36, h - 90, c.frame, wallZ + 15, 80, id + '-mullion');
      add(x + 45, y + h * .57, w / 2 - 63, 36, c.frame, wallZ + 15, 80, id + '-transom-left');
      add(x + w / 2 + 18, y + h * .57, w / 2 - 63, 36, c.frame, wallZ + 15, 80, id + '-transom-right');
    }
    if (door) {
      add(x + w - 135, y + 950, 25, 300, '#c8c7bc', wallZ + 70, 35, 'door-handle');
      add(x + 45, y + h - 190, w - 90, 145, c.frame, wallZ + 12, 65, 'door-bottom-rail');
      add(x - 50, y + h - 15, w + 100, 15, '#d4cabb', wallZ + 130, 190, 'entrance-threshold');
      for (let step = 0; step < 3; step++) {
        const width = 1900 + step * 180;
        add(x + w / 2 - width / 2, y + h + step * 150, width, 150, step === 0 ? '#cec6b9' : '#bdb6aa',
          wallZ + 650 + step * 300, 650 + step * 300, 'entrance-step-' + (step + 1));
      }
    } else add(x - 55, y + h + 5, w + 110, 40, c.trim, wallZ + 90, 140, id + '-sill');
  };

  if (place === 'shop') {
    window(550, 1440, 2100, 2100, false);
    window(3000, 1440, 2100, 2100, false);
    window(5900, 1440, 1100, 2100, false, true);
    for (const x of [595, 3045]) add(x, 1640, 2010, 30, c.frame, wallZ + 15, 80, 'shop-transom');
  } else if (place === 'entrance') {
    window(650, 1540, 1800, 2000, true);
    window(3350, 1440, 1100, 2100, false, true);
    window(5350, 1540, 1800, 2000, true);
    for (const x of [3100, 4590]) add(x, 1440, 40, 2100, c.wood, wallZ + 20, 35, 'entrance-wood-slat');
  } else if (place === 'canopy') {
    window(650, 1540, 1700, 2000, true);
    window(3350, 1440, 1100, 2100, false, true);
    window(5450, 1540, 1700, 2000, true);
  } else {
    for (const x of [400, 2250, 4100]) window(x, 1690, 1400, 1850, true);
    window(5950, 1440, 1100, 2100, false, true);
  }

  if (place === 'canopy') {
    // 3.5 m roof, projecting 1.5 m. Letters stand above its leading edge.
    add(2150, 1150, 3500, 180, '#6e7578', 0, 1500, 'canopy-roof');
    add(2150, 1180, 3500, 150, c.fascia, 0, 80, 'canopy-fascia');
    add(2150, 1330, 3500, 30, '#c6b396', -60, 1380, 'canopy-soffit');
    for (const [side, x] of [['left', 2250], ['right', 5470]] as const) {
      add(x, 1330, 80, 2660, c.frame, -50, 80, 'canopy-column-' + side);
      add(x - 45, 3960, 170, 30, '#51585c', -10, 170, 'canopy-column-base-' + side);
      add(x, 1290, 80, 40, c.frame, -50, 1450, 'canopy-side-beam-' + side);
    }
    for (const x of [3000, 4780]) add(x, 1060, 20, 90, c.frame, -10, 30, 'canopy-sign-upright');
  } else {
    add(300, 430, 7200, 710, palette === 'charcoal' ? '#555f67' : palette === 'brick' ? '#e0d4c3' : '#eee8de', wallZ + 3, 7, 'sign-mounting-band');
    add(300, 1140, 7200, 12, c.joint, wallZ + 5, 12, 'sign-band-bottom');
  }

  const planter = (x: number, width: number, flowers = false) => {
    const z = wallZ + 500;
    add(x, 3640, width, 350, c.planter, z, 440, 'planter-box');
    add(x - 12, 3620, width + 24, 35, '#a59b88', z + 12, 460, 'planter-rim');
    add(x + 25, 3610, width - 50, 20, '#40382c', z - 30, 380, 'planter-soil');
    for (const [i, stemX] of [x + width * .23, x + width * .51, x + width * .77].entries()) {
      const top = 3340 - (i === 1 ? 170 : 0);
      add(stemX, top, 12, 3620 - top, '#5a6650', z - 20, 12, 'plant-stem');
      for (const [dx, dy, angle, size] of [[-60, 60, -35, 115], [45, 120, 30, 130], [-45, 200, -28, 100], [45, 260, 35, 115]])
        add(stemX + dx - size / 2, top + dy, size, size * .6, i === 1 ? '#617454' : '#75876a', z + 25, size * .7, 'plant-leaf', { kind: 'foliage', rotation: angle });
      if (flowers) add(stemX - 35, top - 30, 80, 70, i === 1 ? '#d9b166' : '#b57d70', z + 35, 45, 'planter-flower', { kind: 'flower' });
    }
  };
  planter(50, 400, true); planter(7330, 400);
  for (const x of [250, 7470]) {
    add(x, 1570, 70, 190, '#31393d', wallZ + 60, 80, 'wall-lamp');
    add(x + 9, 1600, 52, 110, night ? '#f4d4a0' : '#e0d0b4', wallZ + 66, 8, 'wall-lamp-lens', { kind: 'lamp', color: night ? '#f4d4a0' : '#e0d0b4' });
  }
  return rects;
}

export function createFacadeSvg(place: SignPlacement, markup: string, night: boolean, prefix = 'main-facade', options: FacadeOptions = {}) {
  if (place === 'none') return markup;
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '-');
  const palette = options.palette ?? 'stone', c = FACADE_COLORS[palette];
  const rects = facadeRects(place, night, options).filter(r=>!options.panelMount||!['sign-mounting-band','sign-band-bottom','canopy-sign-upright'].includes(r.name??''));
  const glass = night ? ['#bba078', '#75674e', '#d6bc8c'] : ['#5e7d8e', '#8498a0', '#354c5a'];
  const defs = `<defs>
    <linearGradient id="${safePrefix}-glass" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="${glass[0]}"/><stop offset=".47" stop-color="${glass[1]}"/><stop offset="1" stop-color="${glass[2]}"/></linearGradient>
    <pattern id="${safePrefix}-brick" patternUnits="userSpaceOnUse" width="480" height="156"><rect width="480" height="156" fill="${nightColor(c.joint, night)}"/><path d="M5 5H235V73H5ZM245 5H475V73H245ZM-115 83H115V151H-115ZM125 83H355V151H125ZM365 83H595V151H365Z" fill="${nightColor(c.wall, night)}"/><path d="M5 5H235M245 5H475M125 83H355" stroke="${nightColor('#d39777', night)}" stroke-width="4"/></pattern>
  </defs>`;
  const wallOpenings = rects.filter(r => r.kind === 'opening');
  const wall = rects[0];
  const wallPath = `M${wall.x} ${wall.y}H${wall.x + wall.w}V${wall.y + wall.h}H${wall.x}Z${wallOpenings.map(r => `M${r.x} ${r.y}V${r.y + r.h}H${r.x + r.w}V${r.y}Z`).join('')}`;
  const rendered = rects.map(r => {
    if (r.kind === 'wall') return `<path d="${wallPath}" fill="${palette === 'brick' ? `url(#${safePrefix}-brick)` : wall.color}" fill-rule="evenodd"/>`;
    if (r.kind === 'foliage' || r.kind === 'flower') return `<ellipse cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w / 2}" ry="${r.h / 2}" fill="${r.color}" transform="rotate(${r.rotation ?? 0} ${r.x + r.w / 2} ${r.y + r.h / 2})"/>`;
    if (r.kind === 'glass') return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="url(#${safePrefix}-glass)"/><path d="M${r.x + r.w * .17} ${r.y}L${r.x + r.w * .50} ${r.y + r.h}M${r.x + r.w * .26} ${r.y}L${r.x + r.w * .59} ${r.y + r.h}" stroke="${night ? '#fff2cf' : '#dce5e8'}" stroke-width="${r.w * .055}" opacity="${night ? '.045' : '.09'}"/>`;
    return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.color}" data-facade-part="${r.name}"${r.kind === 'lamp' ? ' rx="7"' : ''}/>`;
  }).join('');
  if(options.panelMount) return createPanelFacadeSvg(place,markup,night,safePrefix,options,defs,rendered);
  const view = markup.match(/\bviewBox=["']([^"']+)["']/)?.[1].trim().split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = view?.length === 4 && view.every(Number.isFinite) && view[2] > 0 && view[3] > 0 ? view : [0, 0, 1800, 300];
  const signBox = options.signBox ?? { x: vx, y: vy, width: vw, height: vh };
  const x = FACADE_SIGN_ANCHOR.x - signBox.x - signBox.width / 2 + vx;
  const y = FACADE_SIGN_ANCHOR.y - signBox.y - signBox.height / 2 + vy;
  // Each SVG unit is already a millimetre. Keep export margins and dimension lines at the same scale.
  const inner = markup.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/<svg\b([^>]*)>/, (_tag, attrs: string) => `<svg x="${x}" y="${y}" width="${vw}" height="${vh}" data-facade-sign="true" data-sign-width="${signBox.width}" data-sign-height="${signBox.height}" ` + attrs.replace(/\s(?:width|height)="[^"]*"/g, '') + '>')
    .replace(/id="([^"]+)"/g, (_a, id: string) => `id="${safePrefix}-${id}"`).replace(/url\(#([^\)]+)\)/g, (_a, id: string) => `url(#${safePrefix}-${id})`);
  const left = Math.min(0, x), top = Math.min(0, y);
  const width = Math.max(FACADE_VIEWBOX.width, x + vw) - left, height = Math.max(FACADE_VIEWBOX.height, y + vh) - top;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" data-facade-mm="true" role="img" aria-label="Размещение: ${SIGN_PLACEMENTS.find(p => p.id === place)?.title}. Дверь 1100 на 2100 мм${place === 'canopy' ? ', козырёк с выносом 1500 мм' : ''}">${defs}${rendered}${inner}</svg>`;
}

/** Axonometric construction view, using the same wall planes and panel pose as WebGL. */
function createPanelFacadeSvg(place:SignPlacement,markup:string,night:boolean,prefix:string,options:FacadeOptions,defs:string,facade:string) {
  const mount=options.panelMount!,box=options.signBox??{x:0,y:0,width:mount.size,height:mount.size};
  const n=(v:number)=>Number(v.toFixed(3));
  const project=([x,y,z]:[number,number,number])=>[.94*x-.342*z,-y+.041*x+.113*z];
  const rename=(value:string)=>value.replace(/id="([^"]+)"/g,(_a,id:string)=>`id="${prefix}-panel-${id}"`).replace(/url\(#([^\)]+)\)/g,(_a,id:string)=>`url(#${prefix}-panel-${id})`);
  const artwork=rename(markup.match(/<!--panel-face-start-->([\s\S]*?)<!--panel-face-end-->/)?.[1]??'');
  const faceDefs=rename(markup.match(/<defs>[\s\S]*?<\/defs>/)?.[0]??'');
  const corner=mount.mode==='corner',anchorX=corner?7800:FACADE_SIGN_ANCHOR.x;
  const front=`<g data-mount-wall="front" transform="matrix(.94 .041 0 1 ${n(-.94*anchorX)} ${n(-FACADE_SIGN_ANCHOR.y-.041*anchorX)})">${facade}</g>`;
  const side=corner?`<g data-mount-wall="side" transform="matrix(.342 -.113 0 1 0 ${-FACADE_SIGN_ANCHOR.y})">${facade}</g>`:'';
  const c=Math.cos(mount.rotationY),s=Math.sin(mount.rotationY),back=mount.mode==='wall',z=back?0:mount.depth;
  const origin=project(panelMountPoint(mount,[0,0,z]));
  const vector=project([c,0,-s]),centerX=box.x+box.width/2,centerY=box.y+box.height/2;
  // The visible reverse face carries its own artwork, rather than mirrored front artwork.
  const a=back?-vector[0]:vector[0],b=back?-vector[1]:vector[1];
  const face=`<g data-panel-face-world="${back?'back':'front'}" transform="matrix(${n(a)} ${n(b)} 0 1 ${n(origin[0]-a*centerX)} ${n(origin[1]-b*centerX-centerY)})">${artwork}</g>`;
  const steel=night?'#7c8b97':'#34414a';
  const supports=[...mount.arms,...mount.ties].map(segment=>{
    const start=panelMountPoint(mount,segment.start),end=panelMountPoint(mount,segment.end),p=project(start),q=project(end);
    return `<path data-panel-support="true" data-world-start="${start.map(n).join(' ')}" data-world-end="${end.map(n).join(' ')}" d="M${p.map(n).join(' ')}L${q.map(n).join(' ')}" stroke="${steel}" stroke-width="${mount.armProfile}" fill="none"/>`;
  }).join('');
  const plates=mount.plates.map(plate=>{
    const tangent=[-plate.normal[2]*mount.plateWidth/2,0,plate.normal[0]*mount.plateWidth/2];
    const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>project(panelMountPoint(mount,[plate.center[0]+u*tangent[0],plate.center[1]+v*mount.plateHeight/2,plate.center[2]+u*tangent[2]])));
    return `<polygon data-mount-plane="${plate.wall}" points="${points.map(p=>p.map(n).join(',')).join(' ')}" fill="${steel}"/>`;
  }).join('');
  const half=mount.size/2,r=mount.shape==='circle'?half:mount.radius;
  const outline=mount.shape==='square'||!r?[[-half,-half],[half,-half],[half,half],[-half,half]]:Array.from({length:64},(_,i)=>{
    const angle=i*Math.PI/32,x=Math.cos(angle),y=Math.sin(angle);return [Math.sign(x)*(half-r)+r*x,Math.sign(y)*(half-r)+r*y];
  });
  const physical=outline.flatMap(([x,y])=>[project(panelMountPoint(mount,[x,y,0])),project(panelMountPoint(mount,[x,y,mount.depth]))]);
  const sorted=physical.sort((p,q)=>p[0]-q[0]||p[1]-q[1]);
  const cross=(o:number[],p:number[],q:number[])=>(p[0]-o[0])*(q[1]-o[1])-(p[1]-o[1])*(q[0]-o[0]);
  const lower:number[][]=[],upper:number[][]=[];
  for(const p of sorted){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
  for(const p of [...sorted].reverse()){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
  const hull=[...lower.slice(0,-1),...upper.slice(0,-1)];
  const body=`<polygon data-panel-housing="true" points="${hull.map(p=>p.map(n).join(',')).join(' ')}" fill="${night?'#35414a':'#45525c'}"/>`;
  const bounds=[...physical,...[[corner?-7800:-3900,800,0],[corner?0:3900,800,0],[corner?0:3900,-3250,0],[corner?-7800:-3900,-3250,0]].map(p=>project(p as [number,number,number])),...(corner?[[0,800,-7800],[0,-3250,-7800]].map(p=>project(p as [number,number,number])):[])];
  const left=Math.min(...bounds.map(p=>p[0]))-180,top=Math.min(...bounds.map(p=>p[1]))-120;
  const width=Math.max(...bounds.map(p=>p[0]))-left+180,height=Math.max(...bounds.map(p=>p[1]))-top+160;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${[left,top,width,height].map(n).join(' ')}" data-facade-mm="true" data-panel-mount="${mount.mode}" data-panel-pose="${[mount.rotationY,mount.position.x,mount.position.y,mount.position.z].map(n).join(' ')}" role="img" aria-label="Панель-кронштейн ${corner?'на наружном углу здания':'перпендикулярно стене'}, дверь 1100 на 2100 мм">${defs}${faceDefs}${side}${front}${plates}${supports}${body}${face}</svg>`;
}
import { panelMountPoint } from './panelConstruction';
import type { panelMountLayout } from './panelConstruction';
