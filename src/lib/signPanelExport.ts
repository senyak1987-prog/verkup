import { panelConstruction } from "./panelConstruction";

export type PanelSvgConfig = {
  shape: "circle" | "square" | "rounded"; size: number; depth?: number; wallGap?: number; cornerRadius?: number;
  faceColor: string; sideColor: string; image: string; imageScale: number; imageX: number; imageY: number;
  sceneMode?: "day" | "night"; showDimensions?: boolean; flat?: boolean;
};

/** Orthographic elevation: physical edges and arm lengths match the 3D model. */
export function createPanelSvgMarkup(config: PanelSvgConfig) {
  const n = (value: number) => Number(value.toFixed(2));
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const size = Math.min(3000, Math.max(100, config.size));
  const mount = panelConstruction(size, config.shape, config.wallGap, config.cornerRadius);
  const night = config.sceneMode === "night";
  const margin = Math.max(70, size * 0.14);
  const wallX = margin, faceX = wallX + mount.gap, faceY = margin;
  const centerX = faceX + size / 2, centerY = faceY + size / 2;
  const viewWidth = size + mount.gap + margin * 2.4, viewHeight = size + margin * 2.7;
  const colour = night ? "#dce5ee" : "#41505e", steel = night ? "#35414a" : "#34414a";
  const geometry = (fill: string, inset = 0) => config.shape === "circle"
    ? `<circle cx="${n(centerX)}" cy="${n(centerY)}" r="${n(size / 2 - inset)}" fill="${fill}" />`
    : `<rect x="${n(faceX + inset)}" y="${n(faceY + inset)}" width="${n(size - inset * 2)}" height="${n(size - inset * 2)}" rx="${n(Math.max(0, mount.radius - inset))}" fill="${fill}" />`;
  const armEnd = faceX + size / 2 + mount.armEndX;
  const brackets = mount.armYs.map(offset => {
    const y = centerY - offset;
    return `<g data-bracket-arm="true"><rect x="${n(wallX)}" y="${n(y - mount.plateHeight / 2)}" width="5" height="30" fill="${steel}" />
      <rect x="${n(wallX + 5)}" y="${n(y - 10)}" width="${n(armEnd - wallX - 5)}" height="20" fill="${steel}" />
      <line x1="${n(wallX + 6)}" x2="${n(armEnd)}" y1="${n(y - 7)}" y2="${n(y - 7)}" stroke="${night ? "#60717c" : "#6c7c87"}" stroke-width="2" /></g>`;
  }).join("");
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
<svg xmlns="http://www.w3.org/2000/svg" width="${n(viewWidth)}" height="${n(viewHeight)}" viewBox="0 0 ${n(viewWidth)} ${n(viewHeight)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Двусторонняя панель-кронштейн на двух консолях, вид спереди">
  <defs><clipPath id="panel-face-clip">${geometry("#fff", mount.rim)}</clipPath>
    <filter id="panel-face-light" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="${n(size * 0.025)}" flood-color="${escape(config.faceColor)}" flood-opacity="0.55" /></filter></defs>
  <g id="panel-wall"><rect x="${n(wallX - 24)}" y="${n(faceY - 10)}" width="24" height="${n(size + 20)}" fill="${night ? "#53616b" : "#a5afb4"}" /><line x1="${n(wallX)}" x2="${n(wallX)}" y1="${n(faceY - 10)}" y2="${n(faceY + size + 10)}" stroke="${night ? "#89969e" : "#74848f"}" stroke-width="2" /></g>
  <g id="wall-bracket">${brackets}</g>
  <g id="panel-face"${night ? ' filter="url(#panel-face-light)"' : ""}>${geometry(escape(config.sideColor))}${geometry(escape(config.faceColor), mount.rim)}${artwork}</g>
  ${dimensions}
</svg>`;
}
