import { panelMountLayout, panelMountPoint, isPanelCornerMount } from "./panelConstruction";
import type { PanelMountMode } from "./panelConstruction";

export type PanelSvgConfig = {
  shape: "circle" | "square" | "rounded"; size: number; depth?: number; wallGap?: number; cornerRadius?: number;
  faceColor: string; sideColor: string; image: string; imageScale: number; imageX: number; imageY: number;
  sceneMode?: "day" | "night"; lightsOn?: boolean; showDimensions?: boolean; flat?: boolean; mountMode?: PanelMountMode;
};

export function panelSvgFaceBox(size:number,gap:number,mode:PanelMountMode='wall') {
  const margin=Math.max(70,size*.14),left=mode==='corner'?180*Math.SQRT1_2+45:0;
  return {x:margin+left+gap,y:margin,width:size,height:size,margin,left};
}

/** Orthographic elevation: physical edges and arm lengths match the 3D model. */
export function createPanelSvgMarkup(config: PanelSvgConfig) {
  const n = (value: number) => Number(value.toFixed(2));
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const size = Math.min(3000, Math.max(100, config.size));
  const mount = panelMountLayout(size, config.shape, config.wallGap, config.cornerRadius, config.depth, config.mountMode);
  const night = config.sceneMode === "night";
  const lit = night && config.lightsOn !== false;
  const box=panelSvgFaceBox(size,mount.gap,mount.mode),margin=box.margin;
  const wallX = margin+box.left, faceX = box.x, faceY = box.y;
  const centerX = faceX + size / 2, centerY = faceY + size / 2;
  const viewWidth = size + mount.gap + margin * 2.4+box.left, elevationHeight = size + margin * 2.7;
  const viewHeight = elevationHeight + Math.max(220, size * .45);
  const colour = night ? "#dce5ee" : "#41505e", steel = night ? "#35414a" : "#34414a";
  const geometry = (fill: string, inset = 0) => config.shape === "circle"
    ? `<circle cx="${n(centerX)}" cy="${n(centerY)}" r="${n(size / 2 - inset)}" fill="${fill}" />`
    : `<rect x="${n(faceX + inset)}" y="${n(faceY + inset)}" width="${n(size - inset * 2)}" height="${n(size - inset * 2)}" rx="${n(Math.max(0, mount.radius - inset))}" fill="${fill}" />`;
  const armRect=(start:number[],end:number[])=>`<rect x="${n(centerX+Math.min(start[0],end[0]))}" y="${n(centerY-start[1]-mount.armProfile/2)}" width="${n(Math.max(2,Math.abs(end[0]-start[0])))}" height="${mount.armProfile}" fill="${steel}"/>`;
  const brackets=mount.arms.map(segment=>`<g data-bracket-arm="true">${armRect(segment.start,segment.end)}</g>`).join('')
    +mount.ties.map(segment=>armRect(segment.start,segment.end)).join('')
    +mount.plates.map(p=>{const halfWidth=Math.abs(p.normal[2])*mount.plateWidth/2+Math.abs(p.normal[0])*mount.plateThickness/2;return `<rect data-mount-plate="${p.wall}" x="${n(centerX+p.center[0]-halfWidth)}" y="${n(centerY-p.center[1]-mount.plateHeight/2)}" width="${n(halfWidth*2)}" height="${mount.plateHeight}" fill="${steel}"/>`;}).join('');
  const imageSize = size * Math.min(130, Math.max(45, config.imageScale)) / 100;
  const artwork = /^data:image\//i.test(config.image)
    ? `<image href="${escape(config.image)}" x="${n(centerX - imageSize / 2 + size * config.imageX / 100)}" y="${n(centerY - imageSize / 2 + size * config.imageY / 100)}" width="${n(imageSize)}" height="${n(imageSize)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#panel-face-clip)" />`
    : `<g fill="#172333" opacity="0.65" text-anchor="middle" font-family="Arial,sans-serif"><text x="${n(centerX)}" y="${n(centerY)}" font-size="${n(size * 0.075)}" font-weight="700">Ваш логотип</text><text x="${n(centerX)}" y="${n(centerY + size * 0.085)}" font-size="${n(size * 0.04)}">на обеих сторонах</text></g>`;
  const font = Math.max(16, size * 0.038), lineY = faceY + size + margin * 0.55, lineX = faceX + size + margin * 0.55;
  const dimensions = !config.showDimensions ? "" : `<g data-dimensions="true" fill="${colour}" stroke="${colour}" stroke-width="1.5" font-family="Arial,sans-serif" font-size="${n(font)}">
    <path fill="none" d="M${n(faceX)} ${n(lineY - 9)}v18 M${n(faceX + size)} ${n(lineY - 9)}v18 M${n(faceX)} ${n(lineY)}H${n(faceX + size)} M${n(lineX - 9)} ${n(faceY)}h18 M${n(lineX - 9)} ${n(faceY + size)}h18 M${n(lineX)} ${n(faceY)}V${n(faceY + size)}" />
    <text stroke="none" text-anchor="middle" x="${n(centerX)}" y="${n(lineY + font * 1.3)}">${Math.round(size)} мм</text>
    <text stroke="none" text-anchor="middle" transform="translate(${n(lineX + font * 1.3)} ${n(centerY)}) rotate(-90)">${Math.round(size)} мм</text>
    <path fill="none" d="M${n(wallX)} ${n(faceY - 30)}H${n(faceX)} M${n(wallX)} ${n(faceY - 37)}v14 M${n(faceX)} ${n(faceY - 37)}v14" />
    <text stroke="none" text-anchor="middle" x="${n(wallX + mount.gap / 2)}" y="${n(faceY - 40)}" font-size="${n(font * 0.8)}">${mount.gap} мм</text>
  </g>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${n(viewWidth)}" height="${n(viewHeight)}" viewBox="0 0 ${n(viewWidth)} ${n(viewHeight)}" data-panel-mount="${mount.mode}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Двусторонняя панель-кронштейн, ${isPanelCornerMount(mount.mode)?'на углу здания':'перпендикулярно стене'}. Вид лица и схема сверху">
  <defs><clipPath id="panel-face-clip">${geometry("#fff", mount.rim)}</clipPath>
    <filter id="panel-face-light" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="${n(size * 0.025)}" flood-color="${escape(config.faceColor)}" flood-opacity="0.55" /></filter></defs>

  <rect x="${n(wallX-(mount.mode==='corner'?mount.anchorOffset*Math.SQRT1_2+45:margin*.36))}" y="${n(faceY-margin*.18)}" width="${n(mount.mode==='corner'?mount.anchorOffset*Math.SQRT1_2+45:margin*.36)}" height="${n(size+margin*.36)}" fill="${night?'#5b6167':'#c8c0b4'}" data-mount-wall="true"/>
  <g id="wall-bracket">${brackets}</g>
  <!--panel-face-start--><g id="panel-face"${lit ? ' filter="url(#panel-face-light)"' : ""}${night&&!lit?' opacity="0.48"':''}>${geometry(escape(config.sideColor))}${geometry(escape(config.faceColor), mount.rim)}${artwork}</g><!--panel-face-end-->
  ${dimensions}
  ${createPanelPlanMarkup(mount,viewWidth,elevationHeight,Math.max(220,size*.45),night)}
</svg>`;
}

/** Top view makes wall contact and the two sides of a corner unambiguous in a flat drawing. */
function createPanelPlanMarkup(mount: ReturnType<typeof panelMountLayout>, width:number, top:number, height:number, night:boolean) {
  const n=(v:number)=>Number(v.toFixed(2)),depth=mount.depth,size=-(mount.wallX+mount.gap)*2;
  const points=[[-size/2,0,0],[-size/2,0,depth],[size/2,0,depth],[size/2,0,0]].map(p=>panelMountPoint(mount,p as [number,number,number]));
  const reach=Math.max(280,size+mount.gap),wallLength=Math.min(reach,520);
  const wall=isPanelCornerMount(mount.mode)?[[-wallLength,-100],[-100,-100],[-100,-wallLength],[0,-wallLength],[0,0],[-wallLength,0]]:[[-wallLength,0],[wallLength,0],[wallLength,-100],[-wallLength,-100]];
  const all=[...points.map(p=>[p[0],p[2]]),...wall],xs=all.map(p=>p[0]),zs=all.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  const planFont=Math.max(36,size*.08),captionHeight=planFont*1.5;
  const scale=Math.min((width-60)/(maxX-minX),(height-captionHeight-12)/(maxZ-minZ));
  const x=(v:number)=>n(width/2+(v-(minX+maxX)/2)*scale),y=(v:number)=>n(top+captionHeight+(maxZ-v)*scale);
  const polygon=(values:number[][])=>values.map(p=>x(p[0])+','+y(p[1])).join(' ');
  const supports=[...mount.arms,...mount.ties].filter(segment=>Math.abs(segment.start[1]-mount.armYs[0])<.001).map(segment=>{const a=panelMountPoint(mount,segment.start),b=panelMountPoint(mount,segment.end);return `<line x1="${x(a[0])}" y1="${y(a[2])}" x2="${x(b[0])}" y2="${y(b[2])}" stroke="${night?'#a3b0ba':'#45525b'}" stroke-width="${Math.max(2,20*scale)}"/>`;}).join('');
  const plates=mount.plates.filter(p=>Math.abs(p.center[1]-mount.armYs[0])<.001).map(p=>{const tangent:[number,number,number]=[-p.normal[2]*mount.plateWidth/2,0,p.normal[0]*mount.plateWidth/2];const a=panelMountPoint(mount,[p.center[0]-tangent[0],p.center[1],p.center[2]-tangent[2]]),b=panelMountPoint(mount,[p.center[0]+tangent[0],p.center[1],p.center[2]+tangent[2]]);return `<line data-mount-plane="${p.wall}" x1="${x(a[0])}" y1="${y(a[2])}" x2="${x(b[0])}" y2="${y(b[2])}" stroke="${night?'#c8d2da':'#34414a'}" stroke-width="${Math.max(2,5*scale)}"/>`;}).join('');
  return `<g data-panel-plan="${mount.mode}"><text text-anchor="middle" x="${width/2}" y="${top+planFont}" fill="${night?'#b9c8d1':'#58656b'}" font-family="Arial,sans-serif" font-size="${planFont}">Вид сверху · ${mount.mode==='corner'?'угол · по диагонали':mount.mode==='corner-front'?'угол · первая стена':mount.mode==='corner-side'?'угол · вторая стена':'стена'}</text><polygon points="${polygon(wall)}" fill="${night?'#4a515a':'#b9b1a5'}"/>${supports}${plates}<polygon points="${polygon(points.map(p=>[p[0],p[2]]))}" fill="${night?'#647581':'#8798a3'}" stroke="${night?'#d4e0e5':'#34414a'}" stroke-width="1.5"/></g>`;
}
