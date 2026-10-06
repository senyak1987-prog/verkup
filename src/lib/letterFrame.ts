/** Fabrication coordinates are millimetres, with Y increasing downwards. */
export type LetterFrameBox = { x: number; y: number; width: number; height: number };
export type LetterFrameRow = { id: string; box: LetterFrameBox };
export type LetterFrameSegment = LetterFrameBox & {
  id: string;
  kind: 'rail' | 'row-connector' | 'logo-connector';
  rowIds: string[];
};
export type LetterFrameOptions = {
  profile?: number;
  topInset?: number;
  bottomInset?: number;
  logo?: { box: LetterFrameBox; shape: 'circle' | 'square' | 'rounded'; cornerRadius?: number };
};
export type LetterFrameLayout = {
  segments: LetterFrameSegment[];
  rowRails: { id: string; x: number; width: number; top: number; bottom: number }[];
  profile: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const positiveBox = (box: LetterFrameBox) => Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0;

/** True side edge of the logo at a rail centre; null means that rail misses the logo. */
function logoEdges(logo: NonNullable<LetterFrameOptions['logo']>, y: number): [number, number] | null {
  const b = logo.box, dy = y - b.y;
  if (dy < 0 || dy > b.height) return null;
  if (logo.shape === 'circle') {
    const ry = b.height / 2, rx = b.width / 2;
    const half = rx * Math.sqrt(Math.max(0, 1 - ((dy - ry) / ry) ** 2));
    return [b.x + rx - half, b.x + rx + half];
  }
  const r = logo.shape === 'rounded' ? clamp(logo.cornerRadius ?? Math.min(b.width, b.height) * .16, 0, Math.min(b.width, b.height) / 2) : 0;
  const distance = dy < r ? r - dy : dy > b.height - r ? dy - (b.height - r) : 0;
  const inset = distance ? r - Math.sqrt(Math.max(0, r * r - distance * distance)) : 0;
  return [b.x + inset, b.x + b.width - inset];
}

/**
 * Each lettering row has its own pair of rails. Only weld connectors can extend
 * beyond that row's width. Returning rectangles makes SVG and WebGL identical.
 */
export function letterFrameLayout(rows: LetterFrameRow[], options: LetterFrameOptions = {}): LetterFrameLayout {
  const profile = Math.max(1, Number.isFinite(options.profile) ? options.profile! : 15);
  const inset = (value: number | undefined) => clamp(Number.isFinite(value) ? value! : 15, 10, 20);
  const topInset = inset(options.topInset), bottomInset = inset(options.bottomInset);
  const valid = rows.filter(row => positiveBox(row.box)).slice().sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const logo = options.logo && positiveBox(options.logo.box) ? options.logo : undefined;
  const segments: LetterFrameSegment[] = [];
  const add = (id: string, kind: LetterFrameSegment['kind'], x: number, y: number, width: number, height: number, rowIds: string[]) => {
    if (width > .001 && height > .001 && [x, y, width, height].every(Number.isFinite)) {
      const duplicate = segments.find(segment => segment.kind === kind &&
        Math.abs(segment.x - x) < .001 && Math.abs(segment.y - y) < .001 &&
        Math.abs(segment.width - width) < .001 && Math.abs(segment.height - height) < .001);
      if (duplicate) { duplicate.rowIds = [...new Set([...duplicate.rowIds, ...rowIds])]; return; }
      segments.push({ id, kind, x, y, width, height, rowIds });
    }
  };
  const rowRails = valid.map(row => {
    let reference = row.box;
    // With a single row, both objects share the smaller object's two support levels.
    // An offset logo can only define them while both levels remain behind the letters.
    if (valid.length === 1 && logo && logo.box.height < reference.height &&
        logo.box.height >= topInset + bottomInset + profile * 2 &&
        logo.box.y >= reference.y && logo.box.y + logo.box.height <= reference.y + reference.height)
      reference = logo.box;
    const top = reference.y + Math.min(topInset, Math.max(0, (reference.height - profile * 2) / 2)) + profile / 2;
    const bottom = reference.y + reference.height - Math.min(bottomInset, Math.max(0, (reference.height - profile * 2) / 2)) - profile / 2;
    add(`row-${row.id}-top`, 'rail', row.box.x, top - profile / 2, row.box.width, profile, [row.id]);
    if (bottom - top >= profile - .001)
      add(`row-${row.id}-bottom`, 'rail', row.box.x, bottom - profile / 2, row.box.width, profile, [row.id]);
    return { id: row.id, x: row.box.x, width: row.box.width, top, bottom };
  });
  for (let i = 1; i < rowRails.length; i++) {
    const upper = rowRails[i - 1], lower = rowRails[i];
    if (Math.abs(upper.top - lower.top) < .001 && Math.abs(upper.bottom - lower.bottom) < .001 &&
        Math.max(upper.x, lower.x) <= Math.min(upper.x + upper.width, lower.x + lower.width)) continue;
    const startY = Math.min(upper.bottom, lower.top) + profile / 2;
    const endY = Math.max(upper.bottom, lower.top) - profile / 2;
    if (endY <= startY) continue;
    const left = Math.max(upper.x, lower.x), right = Math.min(upper.x + upper.width, lower.x + lower.width);
    const rowIds = [upper.id, lower.id];
    if (right - left >= profile) {
      // Weld at the ends of the shorter/common span; no pipe overhangs a row.
      const xs = right - left >= profile * 3 ? [left, right - profile] : [(left + right - profile) / 2];
      xs.forEach((x, index) => add(`weld-${upper.id}-${lower.id}-${index}`, 'row-connector', x, startY, profile, endY - startY, rowIds));
    } else {
      // Independently moved rows can be disjoint: a stepped welded bridge joins them.
      const upperX = clamp((lower.x + lower.width / 2), upper.x + profile / 2, upper.x + upper.width - profile / 2);
      const lowerX = clamp((upper.x + upper.width / 2), lower.x + profile / 2, lower.x + lower.width - profile / 2);
      const middle = (startY + endY) / 2;
      add(`weld-${upper.id}-${lower.id}-upper`, 'row-connector', upperX - profile / 2, startY, profile, Math.max(0, middle - profile / 2 - startY), rowIds);
      add(`weld-${upper.id}-${lower.id}-bridge`, 'row-connector', Math.min(upperX, lowerX) - profile / 2, middle - profile / 2, Math.abs(upperX - lowerX) + profile, profile, rowIds);
      add(`weld-${upper.id}-${lower.id}-lower`, 'row-connector', lowerX - profile / 2, middle + profile / 2, profile, Math.max(0, endY - middle - profile / 2), rowIds);
    }
  }
  if (logo && rowRails.length) {
    const levels = rowRails.length > 1
      ? rowRails.slice(1).flatMap((lower, i) => [{ row: rowRails[i], y: rowRails[i].bottom }, { row: lower, y: lower.top }])
      : [{ row: rowRails[0], y: rowRails[0].top }, { row: rowRails[0], y: rowRails[0].bottom }];
    const centerY = logo.box.y + logo.box.height / 2;
    const applicable = levels.filter(level => level.y >= logo.box.y + profile / 2 && level.y <= logo.box.y + logo.box.height - profile / 2)
      .sort((a, b) => Math.abs(a.y - centerY) - Math.abs(b.y - centerY)).slice(0, 2);
    const connect = (row: typeof rowRails[number], y: number, id: string) => {
      const edges = logoEdges(logo, y); if (!edges) return;
      const rowRight = row.x + row.width;
      if (edges[1] <= row.x) add(id, 'logo-connector', edges[1] - .5, y - profile / 2, row.x - edges[1] + .5, profile, [row.id]);
      else if (edges[0] >= rowRight) add(id, 'logo-connector', rowRight, y - profile / 2, edges[0] - rowRight + .5, profile, [row.id]);
    };
    if (applicable.length === 2 && Math.abs(applicable[0].y - applicable[1].y) >= profile)
      applicable.forEach((level, i) => connect(level.row, level.y, `logo-inner-${i}`));
    else {
      const nearest = rowRails.slice().sort((a, b) => Math.min(Math.abs(a.top - centerY), Math.abs(a.bottom - centerY)) - Math.min(Math.abs(b.top - centerY), Math.abs(b.bottom - centerY)))[0];
      const railY = Math.abs(nearest.top - centerY) < Math.abs(nearest.bottom - centerY) ? nearest.top : nearest.bottom;
      const y = clamp(railY, logo.box.y + Math.min(profile, logo.box.height / 3), logo.box.y + logo.box.height - Math.min(profile, logo.box.height / 3));
      const commonLeft = Math.max(logo.box.x + profile / 2, nearest.x + profile / 2);
      const commonRight = Math.min(logo.box.x + logo.box.width - profile / 2, nearest.x + nearest.width - profile / 2);
      if (commonRight >= commonLeft && (railY < logo.box.y || railY > logo.box.y + logo.box.height)) {
        // A logo moved above/below a row needs a vertical bridge under its actual
        // outline, rather than an upright at the distant end of the text rail.
        const x = (commonLeft + commonRight) / 2;
        const verticalLogo = { ...logo, box: { x: logo.box.y, y: logo.box.x, width: logo.box.height, height: logo.box.width } };
        const edge = logoEdges(verticalLogo, x)!;
        const end = railY < logo.box.y ? edge[0] + .5 : edge[1] - .5;
        add('logo-weld-vertical', 'logo-connector', x - profile / 2, Math.min(railY, end) + (railY < end ? profile / 2 : 0), profile,
          Math.abs(end - railY) - profile / 2, [nearest.id]);
        return { segments, rowRails, profile };
      }
      connect(nearest, y, 'logo-weld-bridge');
      if (Math.abs(y - railY) > profile) {
        const x = logo.box.x + logo.box.width / 2 <= nearest.x + nearest.width / 2 ? nearest.x : nearest.x + nearest.width - profile;
        add('logo-weld-upright', 'logo-connector', x, Math.min(y, railY) + profile / 2, profile, Math.abs(y - railY) - profile, [nearest.id]);
      }
    }
  }
  return { segments, rowRails, profile };
}
