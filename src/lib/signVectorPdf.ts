import type { SignSceneLayout } from './signSceneGeometry';
import type { NeonDesign } from './neonConstruction';
import { neonBackerOutline, neonDesignPlacement } from './neonConstruction';

type Box = { x: number; y: number; width: number; height: number };
type Transform = { sx: number; sy: number; x: number; y: number };
type Drawing = { path: string; transform?: Transform; width?: number; fill?: boolean };
type Layer = { name: string; color: string; drawings: Drawing[] };
export type VectorPdfProject = {
  productId: 'letters' | 'panel' | 'neon'; lettersText: string;
  mountMode: 'frame' | 'wall' | 'acp'; glowMode: string; haloBackerEnabled: boolean;
  logoEnabled: boolean; logoShape: string; panelShape: string; panelSize: number; panelCornerRadius: number;
  neonBackerShape: string; neonDiameter: number;
};
const number = (v: number) => {
  if (!Number.isFinite(v)) throw new Error('Некорректный контур. Измените шрифт и повторите сохранение.');
  return String(Number(v.toFixed(6)));
};
const point = (x: number, y: number) => `${number(x)} ${number(y)}`;
const polygon = (points: readonly (readonly number[])[], closed = true) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${point(x, y)}`).join('') + (closed ? 'Z' : '');

/** Circles and rounded corners stay cubic curves, never bitmap or polygon approximations. */
export function pdfShapePath(box: Box, shape = 'square', radius = 0): string {
  const { x, y, width: w, height: h } = box;
  if (shape === 'circle') {
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2, step = Math.PI / 4;
    let path = `M${point(cx + rx, cy)}`;
    for (let i = 0; i < 8; i++) {
      const a = i * step, b = a + step, k = 4 / 3 * Math.tan(step / 4);
      path += `C${point(cx + rx * (Math.cos(a) - k * Math.sin(a)), cy + ry * (Math.sin(a) + k * Math.cos(a)))} ${point(cx + rx * (Math.cos(b) + k * Math.sin(b)), cy + ry * (Math.sin(b) - k * Math.cos(b)))} ${point(cx + rx * Math.cos(b), cy + ry * Math.sin(b))}`;
    }
    return path + 'Z';
  }
  const r = shape === 'rounded' ? Math.max(0, Math.min(radius, w / 2, h / 2)) : 0;
  if (!r) return polygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  return `M${point(x + r, y)}L${point(x + w - r, y)}Q${point(x + w, y)} ${point(x + w, y + r)}L${point(x + w, y + h - r)}Q${point(x + w, y + h)} ${point(x + w - r, y + h)}L${point(x + r, y + h)}Q${point(x, y + h)} ${point(x, y + h - r)}L${point(x, y + r)}Q${point(x, y)} ${point(x + r, y)}Z`;
}

/** Absolute SVG M/L/Q/C/Z to PDF paths; quadratics become exact cubics. */
export function pdfPath(path: string, transform?: Transform): { commands: string; bounds: number[] } {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  const transformPoint = (x: number, y: number): [number, number] => transform ? [x * transform.sx + transform.x, y * transform.sy + transform.y] : [x, y];
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const p = (x: number, y: number) => {
    const [a, b] = transformPoint(x, y);
    bounds[0] = Math.min(bounds[0], a); bounds[1] = Math.min(bounds[1], b); bounds[2] = Math.max(bounds[2], a); bounds[3] = Math.max(bounds[3], b);
    return point(a, b);
  };
  let i = 0, command = '', x = 0, y = 0, startX = 0, startY = 0;
  const result: string[] = [];
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++];
    const count = ({ M: 2, L: 2, Q: 4, C: 6, Z: 0 } as Record<string, number>)[command];
    if (count === undefined || i + count > tokens.length) throw new Error('Неподдерживаемый векторный контур. Выберите другой шрифт.');
    if (!count) { result.push('h'); x = startX; y = startY; command = ''; continue; }
    const values = tokens.slice(i, i + count).map(Number); i += count;
    if (!values.every(Number.isFinite)) throw new Error('Повреждённый векторный контур.');
    if (command === 'M') { [x, y] = values; startX = x; startY = y; result.push(`${p(x, y)} m`); command = 'L'; }
    else if (command === 'L') { [x, y] = values; result.push(`${p(x, y)} l`); }
    else if (command === 'C') { result.push(`${p(values[0], values[1])} ${p(values[2], values[3])} ${p(values[4], values[5])} c`); x = values[4]; y = values[5]; }
    else if (command === 'Q') {
      const [qx, qy, endX, endY] = values;
      result.push(`${p(x + (qx - x) * 2 / 3, y + (qy - y) * 2 / 3)} ${p(endX + (qx - endX) * 2 / 3, endY + (qy - endY) * 2 / 3)} ${p(endX, endY)} c`);
      x = endX; y = endY;
    }
  }
  return { commands: result.join('\n'), bounds };
}

const unicode = (value: string) => '<FEFF' + Array.from({ length: value.length }, (_, i) => value.charCodeAt(i).toString(16).padStart(4, '0')).join('') + '>';
const rgb = (hex: string) => [1, 3, 5].map(i => number(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');

/** One physical millimetre is one millimetre on the PDF page, irrespective of the preview camera. */
export function vectorDrawingPdf(layers: Layer[], title: string): Uint8Array<ArrayBuffer> {
  const prepared = layers.filter(layer => layer.drawings.length).map(layer => ({ ...layer, paths: layer.drawings.map(drawing => ({ ...drawing, ...pdfPath(drawing.path, drawing.transform) })) }));
  const bounds = prepared.flatMap(layer => layer.paths.map(path => path.bounds));
  if (!bounds.length || !bounds.flat().every(Number.isFinite)) throw new Error('Добавьте надпись или логотип перед сохранением PDF.');
  const left = Math.min(...bounds.map(b => b[0])) - 10, top = Math.min(...bounds.map(b => b[1])) - 10;
  const width = Math.max(...bounds.map(b => b[2])) - left + 10, height = Math.max(...bounds.map(b => b[3])) - top + 10;
  // PDF 1.7 UserUnit preserves 1:1 for long, joined signs beyond the 5080 mm page limit.
  const pt = 72 / 25.4, userUnit = Math.max(1, Math.ceil(Math.max(width, height) * pt / 14400)), scale = pt / userUnit;
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add(''), pages = add(''), page = add('');
  const layerIds = prepared.map(layer => add(`<< /Type /OCG /Name ${unicode(layer.name)} >>`));
  const content = [`q\n${number(scale)} 0 0 ${number(-scale)} ${number(-left * scale)} ${number((height + top) * scale)} cm\n1 J 1 j`];
  prepared.forEach((layer, index) => {
    content.push(`/OC /L${index} BDC\n${rgb(layer.color)} RG\n1 1 1 rg`);
    for (const path of layer.paths) content.push(`${number(path.width ?? .25)} w\n${path.commands}\n${path.fill ? 'B' : 'S'}`);
    content.push('EMC');
  });
  content.push('Q');
  const stream = content.join('\n') + '\n';
  const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  const info = add(`<< /Title ${unicode(title)} /Subject ${unicode('Плоский векторный макет; масштаб 1:1, миллиметры. Растровое изображение логотипа не трассируется.')} /Creator (Gorod Svet sign configurator) >>`);
  const refs = layerIds.map(id => `${id} 0 R`).join(' ');
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R /OCProperties << /OCGs [${refs}] /D << /Order [${refs}] /ON [${refs}] >> >> >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`;
  objects[page - 1] = `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${number(width * scale)} ${number(height * scale)}] /UserUnit ${userUnit} /Resources << /Properties << ${layerIds.map((id, i) => `/L${i} ${id} 0 R`).join(' ')} >> >> /Contents ${contents} 0 R >>`;
  let pdf = '%PDF-1.7\n', offsets = [0];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export function createSignVectorPdf(project: VectorPdfProject, layout: SignSceneLayout, neon?: { design: NeonDesign; width: number; height: number }): Uint8Array<ArrayBuffer> {
  const backing: Drawing[] = [], frame: Drawing[] = [], letters: Drawing[] = [], logos: Drawing[] = [];
  if (project.productId === 'letters') {
    if (project.mountMode === 'acp') {
      backing.push({ path: pdfShapePath(layout.panelBox) });
      for (const x of layout.seamXs ?? []) if (x > layout.panelBox.x && x < layout.panelBox.x + layout.panelBox.width)
        backing.push({ path: polygon([[x, layout.panelBox.y], [x, layout.panelBox.y + layout.panelBox.height]], false) });
    }
    if (project.mountMode === 'frame') {
      for (const segment of layout.frameSegments ?? []) frame.push({ path: pdfShapePath(segment), fill: true });
      if (project.haloBackerEnabled && ['halo', 'faceHalo'].includes(project.glowMode) && layout.haloBackerPath) backing.push({ path: layout.haloBackerPath });
    }
    for (const row of layout.textRows ?? []) {
      const sx = row.pathBox.width / row.naturalBox.width, sy = row.pathBox.height / row.naturalBox.height;
      if (row.pathData) letters.push({ path: row.pathData, transform: { sx, sy, x: row.pathBox.x - row.naturalBox.x * sx, y: row.pathBox.y - row.naturalBox.y * sy }, fill: true });
    }
    if (project.logoEnabled && layout.logoBox.width > 0) logos.push({ path: pdfShapePath(layout.logoBox, project.logoShape, layout.logoCornerRadius), fill: true });
  } else if (project.productId === 'panel') logos.push({ path: pdfShapePath({ x: 0, y: 0, width: project.panelSize, height: project.panelSize }, project.panelShape, project.panelCornerRadius), fill: true });
  else if (neon) {
    const placement = neonDesignPlacement(neon.design, neon.width, neon.height);
    backing.push({ path: polygon(neonBackerOutline(neon.design, neon.width, neon.height, project.neonBackerShape)) });
    for (const path of neon.design.paths) letters.push({ path: polygon(path, false), transform: { sx: 1, sy: 1, ...placement }, width: project.neonDiameter });
  }
  return vectorDrawingPdf([{ name: 'Контуры подложки', color: '#16803d', drawings: backing }, { name: 'Рама и перемычки', color: '#647078', drawings: frame }, { name: project.productId === 'neon' ? 'Неон' : 'Буквы', color: '#111111', drawings: letters }, { name: 'Корпус логотипа / панель', color: '#111111', drawings: logos }], `Город Свет — ${project.lettersText || 'Макет'} — 1:1`);
}
