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
  { id: 'scandi', title: 'Сканди — светлый и дерево' },
] as const;
export type FacadePalette = typeof FACADE_PALETTES[number]['id'];
export const FACADE_SIGN_ANCHOR = { x: 3900, y: 800 } as const;
export const FACADE_VIEWBOX = { x: 0, y: 0, width: 7800, height: 4050 } as const;
export const CANOPY_FRIEZE = { x: 2150, y: 630, width: 3500, height: 700, frontZ: 0, marginMm: 50 } as const;
export type FacadeSignBox = { x: number; y: number; width: number; height: number };
export type FacadeOptions = { palette?: FacadePalette; signBackMm?: number; signBox?: FacadeSignBox; panelMount?: ReturnType<typeof panelMountLayout>;
  windowLights?: boolean; windowLightLevel?: number };
export type FacadeRect = {
  x: number; y: number; w: number; h: number; color: string;
  /** Millimetres. Front surface relative to the sign mounting surface. */
  z?: number; depth?: number; kind?: 'wall' | 'opening' | 'glass' | 'foliage' | 'flower' | 'lamp';
  name?: string; rotation?: number; radius?: number;
};

/** The architecture stays full size. A sign that exceeds the frieze keeps its actual dimensions. */
export function facadeSignPlacement(place: SignPlacement, width: number, height: number, signBackMm = 20) {
  const anchor = place === 'canopy'
    ? { x: CANOPY_FRIEZE.x + CANOPY_FRIEZE.width / 2, y: CANOPY_FRIEZE.y + CANOPY_FRIEZE.height / 2 }
    : { ...FACADE_SIGN_ANCHOR };
  const rearMm = Math.max(0, Number.isFinite(signBackMm) ? signBackMm : 0), clearanceMm = 4;
  const maxWidthMm = place === 'canopy' ? CANOPY_FRIEZE.width - CANOPY_FRIEZE.marginMm * 2 : 7200;
  const maxHeightMm = place === 'canopy' ? CANOPY_FRIEZE.height - CANOPY_FRIEZE.marginMm * 2 : 710;
  const surface = place === 'canopy'
    ? { x: CANOPY_FRIEZE.x, y: CANOPY_FRIEZE.y, width: CANOPY_FRIEZE.width, height: CANOPY_FRIEZE.height, frontZ: -rearMm - clearanceMm }
    : { x: 300, y: 430, width: 7200, height: 710, frontZ: -rearMm - clearanceMm };
  return { anchor, surface, signRearZ: -rearMm, clearanceMm, maxWidthMm, maxHeightMm,
    fits: Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width <= maxWidthMm && height <= maxHeightMm };
}

export const FACADE_COLORS = {
  stone: { wall: '#ddd7cd', joint: '#c8c0b4', trim: '#e8e1d7', frame: '#39444a', glass: '#5d7781', fascia: '#444c50', wood: '#a58261', ground: '#b3ada4', planter: '#877366' },
  brick: { wall: '#bc8062', joint: '#ab9580', trim: '#d7c7b5', frame: '#303b43', glass: '#526d7b', fascia: '#39444d', wood: '#a87d57', ground: '#ada59b', planter: '#725348' },
  charcoal: { wall: '#e3e0d8', joint: '#aaa89f', trim: '#3c4242', frame: '#293332', glass: '#789698', fascia: '#353c3b', wood: '#b99061', ground: '#b4b2a9', planter: '#414947' },
  scandi: { wall: '#e7e1d3', joint: '#b8b1a2', trim: '#d6cebb', frame: '#35453f', glass: '#839d9e', fascia: '#a98458', wood: '#b68b5a', ground: '#b6b5ab', planter: '#49594c' },
} as const;

function nightColor(hex: string, night: boolean, amount = .58) {
  if (!night) return hex;
  return '#' + hex.slice(1).match(/../g)!.map(part => Math.round(parseInt(part, 16) * amount).toString(16).padStart(2, '0')).join('');
}

/** One architectural description supplies the SVG and the 3D model. No coplanar glass/frame surfaces. */
export function facadeRects(place: SignPlacement, night: boolean, options: FacadeOptions = {}, panelWallSurface = false): FacadeRect[] {
  const palette = options.palette ?? 'stone', c = FACADE_COLORS[palette];
  const wallZ = place === 'canopy' ? -1500 : 0;
  const rects: FacadeRect[] = [];
  const add = (x: number, y: number, w: number, h: number, color: string, z = wallZ + 8, depth = 8,
    name = 'detail', extra: Partial<FacadeRect> = {}) => rects.push({ x, y, w, h, color: nightColor(color, night), z, depth, name, ...extra });
  add(0, 0, 7800, 3990, c.wall, wallZ, 200, 'wall', { kind: 'wall' });
  add(0, 0, 7800, 100, c.trim, wallZ + 25, 45, 'cornice');
  add(0, 100, 7800, 15, c.joint, wallZ + 8, 12, 'cornice-shadow');
  add(0, 3770, 7800, 220, '#666b67', wallZ + 20, 45, 'plinth');
  add(0, 3990, 7800, 60, c.ground, wallZ + 2400, 2650, 'pavement');

  if (palette === 'stone') {
    for (const y of [450, 1350, 3780]) add(0, y, 7800, 8, c.joint, wallZ + 2, 3, 'stone-course');
    for (const [x, y, h] of [[1800, 120, 330], [6000, 120, 330], [240, 460, 890], [7540, 460, 890]]) add(x, y, 8, h, c.joint, wallZ + 2, 3, 'stone-joint');
  }

  const window = (x: number, y: number, w: number, h: number, divided: boolean, door = false) => {
    const id = door ? 'door' : 'window-' + x;
    // Back of the opening, glazing, frame and stone trim have distinct depths.
    add(x, y, w, h, '#293942', wallZ - 130, 12, id + '-opening', { kind: 'opening' });
    add(x + 45, y + 45, w - 90, h - 90, night ? '#dcc294' : c.glass, wallZ - 110, 10, id + '-glass', { kind: 'glass', color: night ? '#dcc294' : c.glass });
    for (const [bx, by, bw, bh] of [[x - 50, y - 50, w + 100, 50], [x - 50, y + h, w + 100, 50], [x - 50, y, 50, h], [x + w, y, 50, h]])
      add(bx, by, bw, bh, c.trim, wallZ + 25, 90, id + '-stone-reveal');
    for (const [bx, by, bw, bh] of [[x, y, w, 45], [x, y + h - 45, w, 45], [x, y + 45, 45, h - 90], [x + w - 45, y + 45, 45, h - 90]])
      add(bx, by, bw, bh, c.frame, wallZ - 25, 95, id + '-frame');
    if (divided) {
      add(x + w / 2 - 18, y + 45, 36, h - 90, c.frame, wallZ - 25, 85, id + '-mullion');
      add(x + 45, y + h * .72, w / 2 - 63, 30, c.frame, wallZ - 25, 85, id + '-transom-left');
      add(x + w / 2 + 18, y + h * .72, w / 2 - 63, 30, c.frame, wallZ - 25, 85, id + '-transom-right');
    }
    if (door) {
      if (palette !== 'stone') {
        // Timber remains outside the physical door aperture and below the sign band.
        for (const sx of [x - 220, x + w + 60]) {
          add(sx, y - 100, 160, h + 100, '#70583d', wallZ + 18, 30, 'scandi-timber-backing');
          for (let slat = 0; slat < 4; slat++) add(sx + slat * 40, y - 100, 28, h + 100, c.wood, wallZ + 45, 40, 'scandi-wood-slat');
        }
        if (place !== 'canopy') {
          add(x - 250, y - 170, w + 500, 80, c.frame, wallZ + 760, 780, 'scandi-entry-canopy');
          add(x - 220, y - 90, w + 440, 22, c.wood, wallZ + 720, 700, 'scandi-canopy-soffit');
        }
      }
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
    for (const x of [400, 2250, 4100]) window(x, 1440, 1400, 2100, true);
    window(5950, 1440, 1100, 2100, false, true);
  }

  if (place === 'canopy') {
    if (options.panelMount || panelWallSurface) {
      // Perpendicular panels remain anchored to their existing wall/corner planes.
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
      // A hollow canopy: the upper roof sheet and vertical front frieze do not share coplanar faces.
      add(CANOPY_FRIEZE.x, CANOPY_FRIEZE.y - 30, CANOPY_FRIEZE.width, 30, '#6e7578', 0, 1500, 'canopy-roof');
      add(CANOPY_FRIEZE.x, CANOPY_FRIEZE.y, CANOPY_FRIEZE.width, CANOPY_FRIEZE.height, c.fascia, 0, 80, 'canopy-fascia');
      add(CANOPY_FRIEZE.x, CANOPY_FRIEZE.y + CANOPY_FRIEZE.height, CANOPY_FRIEZE.width, 30, '#c6b396', -60, 1380, 'canopy-soffit');
      add(CANOPY_FRIEZE.x, CANOPY_FRIEZE.y, CANOPY_FRIEZE.width, 80, c.frame, -1420, 80, 'canopy-rear-beam');
      for (const [side, x] of [['left', 2250], ['right', 5470]] as const) {
        add(x, 1360, 80, 2630, c.frame, -50, 80, 'canopy-column-' + side);
        add(x - 45, 3960, 170, 30, '#51585c', -10, 170, 'canopy-column-base-' + side);
        const returnX = side === 'left' ? CANOPY_FRIEZE.x : CANOPY_FRIEZE.x + CANOPY_FRIEZE.width - 80;
        add(returnX, CANOPY_FRIEZE.y, 80, CANOPY_FRIEZE.height, c.frame, -80, 1420, 'canopy-side-return-' + side);
      }
    }
  } else {
    add(300, 430, 7200, 710, palette === 'scandi' ? c.wood : palette === 'charcoal' ? c.fascia : palette === 'brick' ? '#e0d4c3' : '#eee8de', wallZ + 3, 7, 'sign-mounting-band');
    add(300, 1140, 7200, 12, c.joint, wallZ + 5, 12, 'sign-band-bottom');
    for (const [x,y,w,h] of [[288,418,7224,12],[288,1140,7224,12],[288,430,12,710],[7500,430,12,710]])
      add(x,y,w,h,palette === 'charcoal' ? '#5b6361' : c.trim,wallZ+8,18,'sign-band-edge');
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
  const windowsOn = night && (options.windowLights ?? night);
  const windowLevel = windowsOn ? Math.max(0, Math.min(1, Number.isFinite(options.windowLightLevel) ? options.windowLightLevel! : 1)) : 0;
  const glass = night ? ['#253844', '#34424a', '#15232d'] : ['#7893a3', '#557482', '#273e4b'];
  const glazing = rects.filter(r => r.kind === 'glass');
  const reliefRects = rects.filter(r => r.name === 'cornice' || r.name?.includes('stone-reveal') || r.name?.includes('-sill') || r.name?.startsWith('entrance-step') || r.name?.startsWith('canopy-') || r.name === 'planter-box' || r.name === 'wall-lamp');
  const defs = `<defs>
    <filter id="${safePrefix}-frosted-interior" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="30"/></filter>
    <radialGradient id="${safePrefix}-window-spill"><stop stop-color="#ffd9a1" stop-opacity=".62"/><stop offset=".5" stop-color="#ffca80" stop-opacity=".25"/><stop offset="1" stop-color="#ffd9a1" stop-opacity="0"/></radialGradient>
    <linearGradient id="${safePrefix}-glass" x1=".12" y1="0" x2=".82" y2="1"><stop stop-color="${glass[0]}"/><stop offset=".38" stop-color="${glass[1]}"/><stop offset="1" stop-color="${glass[2]}"/></linearGradient>
    <linearGradient id="${safePrefix}-glass-reflection" x1="0" y1=".1" x2="1" y2=".7"><stop stop-color="#e8f0f2" stop-opacity="0"/><stop offset=".35" stop-color="#e8f0f2" stop-opacity=".05"/><stop offset=".52" stop-color="#eef5f5" stop-opacity=".22"/><stop offset=".68" stop-color="#d7e3e7" stop-opacity=".07"/><stop offset="1" stop-color="#b0c5cf" stop-opacity="0"/></linearGradient>
    <linearGradient id="${safePrefix}-window-warm" x1="0" y1="0" x2=".25" y2="1"><stop stop-color="#96764d"/><stop offset=".3" stop-color="#d9b276"/><stop offset=".72" stop-color="#b59262"/><stop offset="1" stop-color="#72604b"/></linearGradient>
    <radialGradient id="${safePrefix}-window-lamp" cx=".5" cy=".02" r=".85"><stop stop-color="#fff3cc" stop-opacity=".60"/><stop offset=".5" stop-color="#ffe5aa" stop-opacity=".16"/><stop offset="1" stop-color="#ffe5aa" stop-opacity="0"/></radialGradient>
    <linearGradient id="${safePrefix}-wall-shade" x1="0" y1="0" x2=".4" y2="1"><stop stop-color="#fffdf7" stop-opacity="${night ? '.015' : '.12'}"/><stop offset=".5" stop-color="#f5eee1" stop-opacity="0"/><stop offset="1" stop-color="#1c2831" stop-opacity="${night ? '.14' : '.09'}"/></linearGradient>
    <linearGradient id="${safePrefix}-panel-housing" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="${night ? '#596670' : '#74838d'}"/><stop offset=".23" stop-color="${night ? '#36444f' : '#495b68'}"/><stop offset=".72" stop-color="${night ? '#23323e' : '#2b3d4a'}"/><stop offset="1" stop-color="${night ? '#37434c' : '#596670'}"/></linearGradient>
    ${reliefRects.map((r, index) => `<filter id="${safePrefix}-architectural-shadow-${index}" filterUnits="userSpaceOnUse" x="${r.x - 55}" y="${r.y - 40}" width="${r.w + 120}" height="${r.h + 120}" color-interpolation-filters="sRGB"><feDropShadow dx="16" dy="26" stdDeviation="10" flood-color="#17212a" flood-opacity="${night ? '.11' : '.23'}"/></filter>`).join('')}
    <filter id="${safePrefix}-panel-shadow" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="18"/></filter>
    <pattern id="${safePrefix}-brick" patternUnits="userSpaceOnUse" width="480" height="156"><rect width="480" height="156" fill="${nightColor(c.joint, night)}"/><path d="M5 5H235V73H5ZM245 5H475V73H245ZM-115 83H115V151H-115ZM125 83H355V151H125ZM365 83H595V151H365Z" fill="${nightColor(c.wall, night)}"/></pattern>
    ${glazing.map((r, index) => `<clipPath id="${safePrefix}-window-clip-${index}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/></clipPath>`).join('')}
  </defs>`;
  const wallOpenings = rects.filter(r => r.kind === 'opening');
  const wall = rects[0];
  const wallPath = `M${wall.x} ${wall.y}H${wall.x + wall.w}V${wall.y + wall.h}H${wall.x}Z${wallOpenings.map(r => `M${r.x} ${r.y}V${r.y + r.h}H${r.x + r.w}V${r.y}Z`).join('')}`;
  let windowIndex = 0;
  const rendered = rects.map(r => {
    if (r.kind === 'wall') return `<path d="${wallPath}" fill="${wall.color}" fill-rule="evenodd"/>${palette === 'brick' ? `<path d="${wallPath}" fill="url(#${safePrefix}-brick)" fill-rule="evenodd" opacity=".35"/>` : ''}<path d="${wallPath}" fill="url(#${safePrefix}-wall-shade)" fill-rule="evenodd"/>`;
    if (r.kind === 'foliage' || r.kind === 'flower') return `<ellipse cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w / 2}" ry="${r.h / 2}" fill="${r.color}" transform="rotate(${r.rotation ?? 0} ${r.x + r.w / 2} ${r.y + r.h / 2})"/>`;
    if (r.kind === 'glass') {
      const index = windowIndex++, x = r.x, y = r.y, w = r.w, h = r.h;
      return `<g clip-path="url(#${safePrefix}-window-clip-${index})" data-facade-part="${r.name}">
        <rect data-window-base="true" x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${safePrefix}-glass)"/>
        <g data-window-light="true" data-window-index="${index}" style="--window-order:${index}" opacity="${windowLevel}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${safePrefix}-window-warm)"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${safePrefix}-window-lamp)"/><path d="M${x + w * .12} ${y + h * .71}H${x + w * .54}V${y + h}H${x + w * .12}ZM${x + w * .73} ${y + h * .46}H${x + w * .84}V${y + h}H${x + w * .73}Z" fill="#4e463b" opacity=".12" filter="url(#${safePrefix}-frosted-interior)"/></g>
        <g data-window-reflection="true" data-window-index="${index}" opacity="${night ? '.24' : '.82'}"><path d="M${x - w * .2} ${y}H${x + w * .2}L${x + w * .84} ${y + h}H${x + w * .45}Z" fill="url(#${safePrefix}-glass-reflection)"/><path d="M${x} ${y + h * .23}C${x + w * .25} ${y + h * .11} ${x + w * .68} ${y + h * .25} ${x + w} ${y + h * .14}V${y}H${x}Z" fill="#b9ccd6" opacity=".16"/><path d="M${x + w * .7} ${y + h * .46}H${x + w * .97}V${y + h}H${x + w * .7}ZM${x} ${y + h * .69}H${x + w * .17}V${y + h}H${x}Z" fill="#182e3d" opacity=".10"/></g>
        <path d="M${x + 8} ${y + h - 8}V${y + 8}H${x + w - 8}" fill="none" stroke="#dce7e8" stroke-opacity="${night ? '.06' : '.17'}" stroke-width="7"/>
      </g>`;
    }
    const reliefIndex = reliefRects.indexOf(r), relief = reliefIndex >= 0;
    const shadow = relief ? ` filter="url(#${safePrefix}-architectural-shadow-${reliefIndex})"` : '';
    return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.color}" data-facade-part="${r.name}"${r.kind === 'lamp' ? ' rx="7"' : ''}${shadow}/>${relief && r.h > 35 ? `<path d="M${r.x + 2} ${r.y + 3}H${r.x + r.w - 2}" stroke="#f2ede1" stroke-width="5" opacity="${night ? '.035' : '.12'}"/>` : ''}`;
  }).join('');
  const spill=glazing.map((r,index)=>`<ellipse data-window-spill="true" data-window-light="true" data-window-index="${index}" style="--window-order:${index}" opacity="${windowLevel}" cx="${r.x+r.w/2}" cy="3998" rx="${r.w*.65}" ry="42" fill="url(#${safePrefix}-window-spill)"/>`).join('');
  if(options.panelMount) return createPanelFacadeSvg(place,markup,night,safePrefix,options,defs,rendered+spill);
  const view = markup.match(/\bviewBox=["']([^"']+)["']/)?.[1].trim().split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = view?.length === 4 && view.every(Number.isFinite) && view[2] > 0 && view[3] > 0 ? view : [0, 0, 1800, 300];
  const signBox = options.signBox ?? { x: vx, y: vy, width: vw, height: vh };
  const placement = facadeSignPlacement(place, signBox.width, signBox.height, options.signBackMm);
  const x = placement.anchor.x - signBox.x - signBox.width / 2 + vx;
  const y = placement.anchor.y - signBox.y - signBox.height / 2 + vy;
  // Each SVG unit is already a millimetre. Keep export margins and dimension lines at the same scale.
  const inner = markup.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/<svg\b([^>]*)>/, (_tag, attrs: string) => `<svg x="${x}" y="${y}" width="${vw}" height="${vh}" data-facade-sign="true" data-sign-width="${signBox.width}" data-sign-height="${signBox.height}" ` + attrs.replace(/\s(?:width|height)="[^"]*"/g, '') + '>')
    .replace(/id="([^"]+)"/g, (_a, id: string) => `id="${safePrefix}-${id}"`).replace(/url\(#([^\)]+)\)/g, (_a, id: string) => `url(#${safePrefix}-${id})`);
  const left = Math.min(0, x), top = Math.min(0, y);
  const width = Math.max(FACADE_VIEWBOX.width, x + vw) - left, height = Math.max(FACADE_VIEWBOX.height, y + vh) - top;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" data-facade-mm="true" data-facade-night="${night}" data-window-lights="${windowsOn}" data-window-light-level="${windowLevel}" data-sign-anchor="${placement.anchor.x} ${placement.anchor.y}" data-sign-fits-surface="${placement.fits}" role="img" aria-label="Размещение: ${SIGN_PLACEMENTS.find(p => p.id === place)?.title}. Дверь 1100 на 2100 мм${place === 'canopy' ? ', вывеска на переднем фризе козырька с выносом 1500 мм' : ''}">${defs}${rendered}${spill}${inner}</svg>`;
}

/** Axonometric construction view, using the same wall planes and panel pose as WebGL. */
function createPanelFacadeSvg(place:SignPlacement,markup:string,night:boolean,prefix:string,options:FacadeOptions,defs:string,facade:string) {
  const mount=options.panelMount!,box=options.signBox??{x:0,y:0,width:mount.size,height:mount.size};
  const n=(v:number)=>Number(v.toFixed(3));
  const project=([x,y,z]:[number,number,number])=>[.94*x-.342*z,-y+.041*x+.113*z];
  const rename=(value:string)=>value.replace(/id="([^"]+)"/g,(_a,id:string)=>`id="${prefix}-panel-${id}"`).replace(/url\(#([^\)]+)\)/g,(_a,id:string)=>`url(#${prefix}-panel-${id})`);
  const artwork=rename(markup.match(/<!--panel-face-start-->([\s\S]*?)<!--panel-face-end-->/)?.[1]??'');
  const faceDefs=rename(markup.match(/<defs>[\s\S]*?<\/defs>/)?.[0]??'');
  const corner=isPanelCornerMount(mount.mode),anchorX=corner?7800:FACADE_SIGN_ANCHOR.x;
  const front=`<g data-mount-wall="front" transform="matrix(.94 .041 0 1 ${n(-.94*anchorX)} ${n(-FACADE_SIGN_ANCHOR.y-.041*anchorX)})">${facade}</g>`;
  const windowCount=(facade.match(/data-window-base="true"/g)??[]).length;
  const sideFacade=facade.replace(/data-window-index="(\d+)"/g,(_tag,index:string)=>`data-window-index="${Number(index)+windowCount}"`)
    .replace(/--window-order:(\d+)/g,(_tag,index:string)=>`--window-order:${Number(index)+windowCount}`);
  const side=corner?`<g data-mount-wall="side" transform="matrix(.342 -.113 0 1 0 ${-FACADE_SIGN_ANCHOR.y})">${sideFacade}</g>`:'';
  const c=Math.cos(mount.rotationY),s=Math.sin(mount.rotationY),back=s*.342+c*.94<0,z=back?0:mount.depth;
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
  const outline=mount.shape==='square'||!r?[[-half,-half],[half,-half],[half,half],[-half,half]]:Array.from({length:128},(_,i)=>{
    const angle=i*Math.PI/64,x=Math.cos(angle),y=Math.sin(angle);return [Math.sign(x)*(half-r)+r*x,Math.sign(y)*(half-r)+r*y];
  });
  const worldOutline=outline.flatMap(([x,y])=>[panelMountPoint(mount,[x,y,0]),panelMountPoint(mount,[x,y,mount.depth])]);
  const physical=worldOutline.map(point=>project(point));
  const sorted=physical.sort((p,q)=>p[0]-q[0]||p[1]-q[1]);
  const cross=(o:number[],p:number[],q:number[])=>(p[0]-o[0])*(q[1]-o[1])-(p[1]-o[1])*(q[0]-o[0]);
  const lower:number[][]=[],upper:number[][]=[];
  for(const p of sorted){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
  for(const p of [...sorted].reverse()){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
  const hull=[...lower.slice(0,-1),...upper.slice(0,-1)];
  const body=`<polygon data-panel-housing="true" points="${hull.map(p=>p.map(n).join(',')).join(' ')}" fill="url(#${prefix}-panel-housing)" stroke="${night?'#66737b':'#89959a'}" stroke-width="3" stroke-linejoin="round"/>`;
  const convex=(points:number[][])=>{
    const ordered=[...points].sort((p,q)=>p[0]-q[0]||p[1]-q[1]),lo:number[][]=[],hi:number[][]=[];
    for(const p of ordered){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);}
    for(const p of [...ordered].reverse()){while(hi.length>=2&&cross(hi[hi.length-2],hi[hi.length-1],p)<=0)hi.pop();hi.push(p);}
    return [...lo.slice(0,-1),...hi.slice(0,-1)];
  };
  // Project the housing and brackets onto the actual wall planes along one light ray.
  const cast=(point:[number,number,number],wall:'front'|'side')=>{
    // Default editable scene light: (-1.28, +1.2, +2.8) toward the construction.
    const sunX=1.28/2.8,sunY=1.2/2.8;
    const distance=wall==='front'?point[2]:-point[0]/sunX;
    if(distance<0)return undefined;
    return project([point[0]+sunX*distance,point[1]-sunY*distance,point[2]-distance]);
  };
  const shadowPlanes=corner?['front','side'] as const:['front'] as const;
  const shadowDefs=shadowPlanes.map(wall=>{
    const corners=wall==='front'?(corner?[[-7800,800,0],[0,800,0],[0,-3250,0],[-7800,-3250,0]]:[[-3900,800,0],[3900,800,0],[3900,-3250,0],[-3900,-3250,0]])
      :[[0,800,0],[0,800,-7800],[0,-3250,-7800],[0,-3250,0]];
    return `<clipPath id="${prefix}-cast-wall-${wall}"><polygon points="${corners.map(point=>project(point as [number,number,number]).map(n).join(',')).join(' ')}"/></clipPath>`;
  }).join('');
  const shadows=shadowPlanes.map(wall=>{
    const points=worldOutline.map(point=>cast(point,wall)).filter((point):point is number[]=>!!point),shadowHull=convex(points);
    const housing=shadowHull.length>2?`<polygon points="${shadowHull.map(point=>point.map(n).join(',')).join(' ')}"/>`:'';
    const arms=[...mount.arms,...mount.ties].map(segment=>{
      const p=cast(panelMountPoint(mount,segment.start),wall),q=cast(panelMountPoint(mount,segment.end),wall);
      return p&&q?`<path d="M${p.map(n).join(' ')}L${q.map(n).join(' ')}" fill="none" stroke="#111c26" stroke-width="${mount.armProfile}"/>`:'';
    }).join('');
    return `<g data-panel-cast-shadow="${wall}" clip-path="url(#${prefix}-cast-wall-${wall})" fill="#111c26" opacity="${night?'.08':'.24'}"><g filter="url(#${prefix}-panel-shadow)">${housing}${arms}</g></g>`;
  }).join('');
  const bounds=[...physical,...[[corner?-7800:-3900,800,0],[corner?0:3900,800,0],[corner?0:3900,-3250,0],[corner?-7800:-3900,-3250,0]].map(p=>project(p as [number,number,number])),...(corner?[[0,800,-7800],[0,-3250,-7800]].map(p=>project(p as [number,number,number])):[])];
  const left=Math.min(...bounds.map(p=>p[0]))-180,top=Math.min(...bounds.map(p=>p[1]))-120;
  const width=Math.max(...bounds.map(p=>p[0]))-left+180,height=Math.max(...bounds.map(p=>p[1]))-top+160;
  const windowsOn=night&&(options.windowLights??night),windowLevel=windowsOn?Math.max(0,Math.min(1,Number.isFinite(options.windowLightLevel)?options.windowLightLevel!:1)):0;
  const signAnchor=project(panelMountPoint(mount,[0,0,mount.depth/2]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${[left,top,width,height].map(n).join(' ')}" data-facade-mm="true" data-facade-night="${night}" data-window-lights="${windowsOn}" data-window-light-level="${windowLevel}" data-panel-mount="${mount.mode}" data-panel-pose="${[mount.rotationY,mount.position.x,mount.position.y,mount.position.z].map(n).join(' ')}" data-sign-anchor="${signAnchor.map(n).join(' ')}" role="img" aria-label="Панель-кронштейн ${corner?'на наружном углу здания':'перпендикулярно стене'}, дверь 1100 на 2100 мм">${defs}<defs>${shadowDefs}</defs>${faceDefs}${side}${front}${shadows}${plates}${supports}${body}${face}</svg>`;
}
import { panelMountPoint, isPanelCornerMount } from './panelConstruction';
import type { panelMountLayout } from './panelConstruction';
