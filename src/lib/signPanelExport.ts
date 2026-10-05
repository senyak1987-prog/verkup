export type PanelSvgConfig = {
  shape: "circle" | "square" | "rounded";
  size: number;
  faceColor: string;
  sideColor: string;
  image: string;
  imageScale: number;
  imageX: number;
  imageY: number;
  sceneMode?: "day" | "night";
};

/** A self-contained scene shared by the browser preview and the SVG download. */
export function createPanelSvgMarkup(config: PanelSvgConfig) {
  const n = (value: number) => Number(value.toFixed(2));
  const escape = (value: string) => value.replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  const mix = (color: string, target: string, amount: number) => {
    const parse = (value: string) => /^#[\da-f]{6}$/i.test(value)
      ? [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16))
      : [35, 43, 54];
    const source = parse(color);
    const destination = parse(target);
    return "#" + source.map((channel, index) =>
      Math.round(channel + (destination[index] - channel) * amount).toString(16).padStart(2, "0"),
    ).join("");
  };
  const size = clamp(config.size, 100, 3000);
  const night = config.sceneMode === "night";
  const faceX = size * 0.31;
  const faceY = size * 0.11;
  const centerX = faceX + size / 2;
  const centerY = faceY + size / 2;
  const depthX = size * 0.056;
  const depthY = size * 0.034;
  const viewWidth = size * 1.48;
  const viewHeight = size * 1.22;
  const radius = config.shape === "rounded" ? size * 0.15 : 0;
  const geometry = (fill: string, dx = 0, dy = 0, stroke = "none", strokeWidth = 0) =>
    config.shape === "circle"
      ? `<circle cx="${n(centerX + dx)}" cy="${n(centerY + dy)}" r="${n(size / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`
      : `<rect x="${n(faceX + dx)}" y="${n(faceY + dy)}" width="${n(size)}" height="${n(size)}" rx="${n(radius)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  const side = night ? mix(config.sideColor, "#08101c", 0.5) : config.sideColor;
  const depthMarkup = Array.from({ length: 9 }, (_, index) => {
    const ratio = (9 - index) / 9;
    return geometry(mix(side, "#01050a", ratio * 0.27), depthX * ratio, depthY * ratio);
  }).join("\n");
  const plateWidth = size * 0.055;
  const plateX = size * 0.06;
  const plateY = centerY - size * 0.26;
  const railHeight = size * 0.032;
  const bracketMarkup = `<g id="wall-bracket" filter="url(#panel-cast-shadow)">
    <rect x="${n(plateX)}" y="${n(plateY)}" width="${n(plateWidth)}" height="${n(size * 0.52)}" rx="${n(size * 0.01)}" fill="url(#panel-steel)" />
    ${[-0.19, 0.19].map((offset) => `<circle cx="${n(plateX + plateWidth / 2)}" cy="${n(centerY + size * offset)}" r="${n(size * 0.008)}" fill="${night ? "#182331" : "#d0d7dd"}" stroke="${night ? "#4f5b6a" : "#566473"}" stroke-width="1.5" />`).join("")}
    ${[-0.19, 0.19].map((offset) => `<g><rect x="${n(plateX + plateWidth * 0.6)}" y="${n(centerY + size * offset - railHeight / 2)}" width="${n(faceX + size * 0.2 - plateX)}" height="${n(railHeight)}" rx="${n(size * 0.004)}" fill="url(#panel-steel)" /><line x1="${n(plateX + plateWidth)}" x2="${n(faceX + size * 0.2)}" y1="${n(centerY + size * offset - railHeight * 0.2)}" y2="${n(centerY + size * offset - railHeight * 0.2)}" stroke="${night ? "#657285" : "#b5bfc8"}" stroke-width="1.5" opacity="0.65" /></g>`).join("")}
  </g>`;
  const imageSize = size * clamp(config.imageScale, 45, 130) / 100;
  const imageX = centerX - imageSize / 2 + size * clamp(config.imageX, -40, 40) / 100;
  const imageY = centerY - imageSize / 2 + size * clamp(config.imageY, -40, 40) / 100;
  const image = /^data:image\//i.test(config.image) ? config.image : "";
  const artwork = image
    ? `<g clip-path="url(#panel-face-clip)"><image href="${escape(image)}" x="${n(imageX)}" y="${n(imageY)}" width="${n(imageSize)}" height="${n(imageSize)}" preserveAspectRatio="xMidYMid meet" /></g>`
    : `<text x="${n(centerX)}" y="${n(centerY)}" dominant-baseline="middle" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-size="${n(size * 0.13)}" fill="#13202b" opacity="0.66">LOGO</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Визуализация панель-кронштейна" width="${n(viewWidth)}mm" height="${n(viewHeight)}mm" viewBox="0 0 ${n(viewWidth)} ${n(viewHeight)}">
  <title>Панель-кронштейн ${n(size)} × ${n(size)} мм — ${night ? "ночной" : "дневной"} вид</title>
  <defs>
    <clipPath id="panel-face-clip">${geometry("#ffffff")}</clipPath>
    <linearGradient id="panel-face-material" x1="0" y1="0" x2="0.18" y2="1">
      <stop offset="0" stop-color="${mix(config.faceColor, "#ffffff", night ? 0.25 : 0.13)}" />
      <stop offset="0.52" stop-color="${escape(config.faceColor)}" />
      <stop offset="1" stop-color="${mix(config.faceColor, "#06101b", night ? 0.02 : 0.1)}" />
    </linearGradient>
    <linearGradient id="panel-steel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${night ? "#4b596a" : "#939ea9"}" />
      <stop offset="0.55" stop-color="${night ? "#202e3b" : "#5c6875"}" />
      <stop offset="1" stop-color="${night ? "#0b1622" : "#354351"}" />
    </linearGradient>
    <filter id="panel-cast-shadow" x="-35%" y="-40%" width="180%" height="200%">
      <feDropShadow dx="${n(depthX * 0.4)}" dy="${n(depthY * 0.8)}" stdDeviation="${n(size * 0.012)}" flood-color="#06101b" flood-opacity="${night ? 0.48 : 0.23}" />
    </filter>
    <filter id="panel-face-light" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="${n(size * 0.02)}" flood-color="${escape(config.faceColor)}" flood-opacity="0.65" />
      <feDropShadow dx="0" dy="0" stdDeviation="${n(size * 0.055)}" flood-color="${escape(config.faceColor)}" flood-opacity="0.36" />
    </filter>
  </defs>
  ${bracketMarkup}
  <g id="panel-side" filter="url(#panel-cast-shadow)">${depthMarkup}</g>
  <g id="panel-face"${night ? ' filter="url(#panel-face-light)"' : ""}>
    ${geometry("url(#panel-face-material)", 0, 0, mix(config.sideColor, "#ffffff", 0.18), n(size * 0.003))}
    ${artwork}
  </g>
</svg>`;
}
