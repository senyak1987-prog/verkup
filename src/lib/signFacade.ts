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
export type FacadeOptions = { palette?: FacadePalette; signBackMm?: number };
export type FacadeRect = {
  x: number; y: number; w: number; h: number; color: string;
  /** Front surface, in facade units, relative to the sign mounting surface. */
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
  const wallZ = place === 'canopy' ? -32 : 0;
  const rects: FacadeRect[] = [];
  const add = (x: number, y: number, w: number, h: number, color: string, z = wallZ + .65, depth = .6,
    name = 'detail', extra: Partial<FacadeRect> = {}) => rects.push({ x, y, w, h, color: nightColor(color, night), z, depth, name, ...extra });
  add(0, 0, 500, 273, c.wall, wallZ, 14, 'wall', { kind: 'wall' });
  add(0, 0, 500, 10, c.trim, wallZ + 1.2, 2.5, 'cornice');
  add(0, 10, 500, 1.4, c.joint, wallZ + .7, .5, 'cornice-shadow');
  add(0, 269, 500, 6, c.trim, wallZ + 1.4, 3, 'plinth');
  add(0, 274, 500, 6, c.ground, wallZ + 54, 70, 'pavement');

  if (palette === 'stone') {
    for (const y of [29, 137, 259]) add(0, y, 500, .65, c.joint, wallZ + .2, .35, 'stone-course');
    for (const [x, y, h] of [[104, 12, 17], [395, 12, 17], [24, 30, 107], [476, 30, 107]]) add(x, y, .6, h, c.joint, wallZ + .2, .35, 'stone-joint');
  } else if (palette === 'charcoal') {
    for (const x of [24, 96, 168, 240, 312, 384, 456]) add(x, 13, .7, 121, c.joint, wallZ + .2, .35, 'cladding-joint');
  }

  const window = (x: number, y: number, w: number, h: number, divided: boolean, door = false) => {
    const id = door ? 'door' : 'window-' + x;
    // Back of the opening, glazing, frame and stone trim have distinct depths.
    add(x, y, w, h, '#293942', wallZ - 9, .8, id + '-opening', { kind: 'opening' });
    add(x + 3, y + 3, w - 6, h - 6, night ? '#dcc294' : c.glass, wallZ - 3.6, .65, id + '-glass', { kind: 'glass', color: night ? '#dcc294' : c.glass });
    for (const [bx, by, bw, bh] of [[x - 3, y - 3, w + 6, 3], [x - 3, y + h, w + 6, 3], [x - 3, y, 3, h], [x + w, y, 3, h]])
      add(bx, by, bw, bh, c.trim, wallZ + 1.5, 4.5, id + '-stone-reveal');
    for (const [bx, by, bw, bh] of [[x, y, w, 3], [x, y + h - 3, w, 3], [x, y + 3, 3, h - 6], [x + w - 3, y + 3, 3, h - 6]])
      add(bx, by, bw, bh, c.frame, wallZ + .95, 5, id + '-frame');
    if (divided) {
      add(x + w / 2 - 1.3, y + 3, 2.6, h - 6, c.frame, wallZ + .95, 5, id + '-mullion');
      add(x + 3, y + h * .57, w / 2 - 4.3, 2.6, c.frame, wallZ + .95, 5, id + '-transom-left');
      add(x + w / 2 + 1.3, y + h * .57, w / 2 - 4.3, 2.6, c.frame, wallZ + .95, 5, id + '-transom-right');
    }
    if (door) {
      add(x + w - 12, y + h * .45, 2, 17, '#c8c7bc', wallZ + 3.1, 1.7, 'door-handle');
      add(x + 3, y + h - 20, w - 6, 17, c.frame, wallZ + .8, 3, 'door-bottom-rail');
      add(x - 8, y + h + 3, w + 16, 3.4, '#d4cabb', wallZ + 17, 24, 'entrance-threshold');
      add(x - 13, y + h + 6.4, w + 26, 3.6, '#bab3a9', wallZ + 25, 31, 'entrance-step');
    } else add(x - 5, y + h + 3, w + 10, 3, c.trim, wallZ + 5, 8, id + '-sill');
  };

  if (place === 'shop') {
    window(45, 143, 132, 116, false);
    window(181, 143, 132, 116, false);
    window(327, 143, 96, 120, false, true);
    add(49, 151, 124, 2, c.frame, wallZ + .95, 5, 'shop-transom-left');
    add(185, 151, 124, 2, c.frame, wallZ + .95, 5, 'shop-transom-right');
  } else if (place === 'entrance') {
    window(54, 146, 108, 113, true);
    window(197, 146, 108, 113, true);
    window(350, 137, 92, 126, false, true);
    for (const x of [327, 451]) add(x, 144, 4, 58, c.wood, wallZ + 1, 1.6, 'entrance-wood-slat');
  } else {
    for (const x of [53, 203, 353]) window(x, 149, 94, 110, true);
  }

  if (place === 'canopy') {
    // The roof is above the letter slot, and the vertical fascia is behind it.
    add(21, 29, 458, 7, '#6e7578', 1.2, 36, 'canopy-roof');
    add(27, 36, 446, 96, c.fascia, 0, 2.5, 'canopy-fascia');
    add(25, 132, 450, 4, '#262e34', 1.3, 36, 'canopy-bottom');
    add(26, 37, 3, 95, '#4b555d', .6, 35, 'canopy-left-return');
    add(471, 37, 3, 95, '#4b555d', .6, 35, 'canopy-right-return');
    for (const x of [56, 444]) add(x, 138, 4, 20, c.frame, wallZ + 15, 19, 'canopy-bracket');
  } else {
    add(29, 38, 442, 94, palette === 'charcoal' ? '#555f67' : palette === 'brick' ? '#e0d4c3' : '#eee8de', wallZ + .35, .65, 'sign-mounting-band');
    add(29, 132, 442, 1.1, c.joint, wallZ + .45, .9, 'sign-band-bottom');
  }

  const planter = (x: number, width: number, flowers = false) => {
    const z = wallZ + 13;
    add(x, 250, width, 21, c.planter, z, 20, 'planter-box');
    add(x - .8, 249, width + 1.6, 2.4, '#a59b88', z + .8, 22, 'planter-rim');
    add(x + 2, 248.7, width - 4, 1.5, '#40382c', z - 2, 16, 'planter-soil');
    for (const [i, stemX] of [x + width * .23, x + width * .51, x + width * .77].entries()) {
      const top = 232 - (i === 1 ? 10 : 0);
      add(stemX, top, 1, 249 - top, '#5a6650', z - 1, 1, 'plant-stem');
      for (const [dx, dy, angle, size] of [[-4, 4, -35, 8], [3, 8, 30, 9], [-3, 13, -28, 7], [3, 17, 35, 8]])
        add(stemX + dx - size / 2, top + dy, size, size * .6, i === 1 ? '#617454' : '#75876a', z + 1.5, size * .7, 'plant-leaf', { kind: 'foliage', rotation: angle });
      if (flowers) add(stemX - 2.5, top - 2, 6, 5, i === 1 ? '#d9b166' : '#b57d70', z + 2.1, 3, 'planter-flower', { kind: 'flower' });
    }
  };
  if (place === 'entrance') { planter(16, 31, true); planter(458, 27); }
  else if (place === 'shop') { planter(8, 27); planter(445, 42, true); }
  else { planter(14, 29, true); planter(461, 27); }
  for (const x of [18, 478]) {
    add(x, 143, 5, 13, '#31393d', wallZ + 2.8, 4, 'wall-lamp');
    add(x + .6, 145, 3.8, 7.5, night ? '#f4d4a0' : '#e0d0b4', wallZ + 3.1, .5, 'wall-lamp-lens', { kind: 'lamp', color: night ? '#f4d4a0' : '#e0d0b4' });
  }
  return rects;
}

export function createFacadeSvg(place: SignPlacement, markup: string, night: boolean, prefix = 'main-facade', options: FacadeOptions = {}) {
  if (place === 'none') return markup;
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '-');
  const palette = options.palette ?? 'stone', c = FACADE_COLORS[palette];
  const rects = facadeRects(place, night, options);
  const glass = night ? ['#bba078', '#75674e', '#d6bc8c'] : ['#5e7d8e', '#8498a0', '#354c5a'];
  const defs = `<defs>
    <linearGradient id="${safePrefix}-glass" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="${glass[0]}"/><stop offset=".47" stop-color="${glass[1]}"/><stop offset="1" stop-color="${glass[2]}"/></linearGradient>
    <pattern id="${safePrefix}-brick" patternUnits="userSpaceOnUse" width="80" height="26"><rect width="80" height="26" fill="${nightColor(c.joint, night)}"/><path d="M.8 .8H39.2V12.2H.8ZM40.8 .8H79.2V12.2H40.8ZM-19.2 13.8H19.2V25.2H-19.2ZM20.8 13.8H59.2V25.2H20.8ZM60.8 13.8H99.2V25.2H60.8Z" fill="${nightColor(c.wall, night)}"/><path d="M.8 .8H39.2M40.8 .8H79.2M20.8 13.8H59.2" stroke="${nightColor('#d39777', night)}" stroke-width=".7"/></pattern>
  </defs>`;
  const wallOpenings = rects.filter(r => r.kind === 'opening');
  const wall = rects[0];
  const wallPath = `M0 0H500V273H0Z${wallOpenings.map(r => `M${r.x} ${r.y}V${r.y + r.h}H${r.x + r.w}V${r.y}Z`).join('')}`;
  const rendered = rects.map(r => {
    if (r.kind === 'wall') return `<path d="${wallPath}" fill="${palette === 'brick' ? `url(#${safePrefix}-brick)` : wall.color}" fill-rule="evenodd"/>`;
    if (r.kind === 'foliage' || r.kind === 'flower') return `<ellipse cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w / 2}" ry="${r.h / 2}" fill="${r.color}" transform="rotate(${r.rotation ?? 0} ${r.x + r.w / 2} ${r.y + r.h / 2})"/>`;
    if (r.kind === 'glass') return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="url(#${safePrefix}-glass)"/><path d="M${r.x + r.w * .17} ${r.y}L${r.x + r.w * .50} ${r.y + r.h}M${r.x + r.w * .26} ${r.y}L${r.x + r.w * .59} ${r.y + r.h}" stroke="${night ? '#fff2cf' : '#dce5e8'}" stroke-width="${r.w * .055}" opacity="${night ? '.045' : '.09'}"/>`;
    return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.color}"${r.kind === 'lamp' ? ' rx=".5"' : ''}/>`;
  }).join('');
  const inner = markup.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/<svg\b([^>]*)>/, (_tag, attrs: string) => '<svg x="75" y="40" width="350" height="90" ' + attrs.replace(/\s(?:width|height)="[^"]*"/g, '') + '>')
    .replace(/id="([^"]+)"/g, (_a, id: string) => `id="${safePrefix}-${id}"`).replace(/url\(#([^\)]+)\)/g, (_a, id: string) => `url(#${safePrefix}-${id})`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 280" role="img" aria-label="Размещение: ${SIGN_PLACEMENTS.find(p => p.id === place)?.title}">${defs}${rendered}${inner}</svg>`;
}
