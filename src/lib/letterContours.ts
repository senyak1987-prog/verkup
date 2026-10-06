import { parse, Path } from "opentype.js";
import type { Font, RenderOptions } from "opentype.js";
import { serializeGlyphPath } from "./glyphPath";
import { systemFontContours } from "./systemFontContours";

export const SIGN_FONTS = [
  { label: "Manrope · современный", value: "Manrope, sans-serif", file: "Manrope-Variable.ttf", weight: 800 },
  { label: "Roboto Condensed · узкий", value: '"Roboto Condensed", sans-serif', file: "RobotoCondensed-Variable.ttf", weight: 900 },
  { label: "Oswald · вытянутый", value: "Oswald, sans-serif", file: "Oswald-Variable.ttf", weight: 700 },
  { label: "Russo One · широкий", value: '"Russo One", sans-serif', file: "RussoOne-Regular.ttf", weight: 400 },
  { label: "Lobster · рукописный", value: "Lobster, cursive", file: "Lobster-Regular.ttf", weight: 400 },
  { label: "Rubik Mono One · плакатный", value: '"Rubik Mono One", sans-serif', file: "RubikMonoOne-Regular.ttf", weight: 400 },
  { label: "Unbounded · широкий геометрический", value: "Unbounded, sans-serif", file: "Unbounded-Variable.ttf", weight: 700 },
  { label: "Exo 2 · технологичный", value: '"Exo 2", sans-serif', file: "Exo2-Variable.ttf", weight: 800 },
  { label: "Pacifico · кисть", value: "Pacifico, cursive", file: "Pacifico-Regular.ttf", weight: 400 },
  { label: "Amatic SC · рисованный", value: '"Amatic SC", cursive', file: "AmaticSC-Bold.ttf", weight: 700 },
  { label: "Comfortaa · округлый", value: "Comfortaa, sans-serif", file: "Comfortaa-Variable.ttf", weight: 700 },
  { label: "Roboto Slab · брусковый", value: '"Roboto Slab", serif', file: "RobotoSlab-Variable.ttf", weight: 800 },
  { label: "Playfair Display · классический", value: '"Playfair Display", serif', file: "PlayfairDisplay-Variable.ttf", weight: 800 },
  { label: "Yeseva One · декоративный", value: '"Yeseva One", serif', file: "YesevaOne-Regular.ttf", weight: 400 },
  { label: "Arial · системный", value: "Arial, sans-serif", file: "", weight: 700 },
  { label: "Arial Black · системный", value: '"Arial Black", sans-serif', file: "", weight: 900 },
] as const;

// Existing saved projects retain their original contours; the picker presents
// a smaller set of distinct lettering styles rather than similar grotesques.
export const LEGACY_SIGN_FONTS = [
  { label: "Montserrat · геометрический", value: "Montserrat, sans-serif", file: "Montserrat-Variable.ttf", weight: 800 },
  { label: "Rubik · мягкий гротеск", value: "Rubik, sans-serif", file: "Rubik-Variable.ttf", weight: 800 },
  { label: "Raleway · элегантный", value: "Raleway, sans-serif", file: "Raleway-Variable.ttf", weight: 800 },
] as const;

export type LetterContours = {
  pathData: string;
  inkBox: { x: number; y: number; width: number; height: number };
  mainBox: { x: number; y: number; width: number; height: number };
  lineFactor?: number;
  lines?: LetterContours[];
};
const fonts = new Map<string, Promise<Font>>();
export function resolveSignFont(value: string) {
  const family = value.split(',')[0].replace(/"/g, '').trim().toLowerCase();
  return [...SIGN_FONTS, ...LEGACY_SIGN_FONTS].find(item => family === item.value.split(',')[0].replace(/"/g, '').toLowerCase()) ?? SIGN_FONTS[0];
}

export function fontLetterPath(font: Font, text: string, weight: number): Path {
  const options = { kerning: true, variation: { wght: weight } } as RenderOptions;
  try { return font.getPath(text, 0, 0, 1000, options); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("substitutionType")) throw error;
    const path = new Path();
    const glyphs = Array.from(text, character => font.charToGlyph(character));
    const scale = 1000 / font.unitsPerEm;
    let x = 0;
    glyphs.forEach((glyph, index) => {
      path.extend(glyph.getPath(x, 0, 1000, options, font));
      x += (glyph.advanceWidth || 0) * scale;
      if (glyphs[index + 1]) x += font.getKerningValue(glyph, glyphs[index + 1]) * scale;
    });
    return path;
  }
}

export function contoursFromFont(font: Font, text: string, weight: number): LetterContours {
  const normalized = text.trim().normalize("NFC");
  for (const character of normalized) if (!font.hasChar(character) && !/\s/.test(character))
    throw new Error(`Шрифт не содержит символ «${character}». Выберите другой шрифт.`);
  const path = fontLetterPath(font, normalized, weight);
  const box = normalized ? path.getBoundingBox() : { x1: 0, y1: 0, x2: 0, y2: 0 };
  // Н/н defines the common lettering line; Д, Ц, Щ, Й and accents extend beyond it.
  const reference = /[\p{Lu}\d]/u.test(normalized) ? "Н" : "н";
  const line = fontLetterPath(font, reference, weight).getBoundingBox();
  return {
    pathData: serializeGlyphPath(path),
    inkBox: { x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 },
    mainBox: { x: box.x1, y: line.y1, width: Math.max(1, box.x2 - box.x1), height: Math.max(1, line.y2 - line.y1) },
  };
}

const contourCache = new Map<string, LetterContours>();
export function combineLetterLines(lines: LetterContours[]): LetterContours {
  if (lines.length === 1) return lines[0];
  const lineHeight = Math.max(...lines.map(line => line.mainBox.height));
  const width = Math.max(...lines.map(line => line.mainBox.width));
  let minY = Infinity, maxY = -Infinity;
  const pathData = lines.map((line, index) => {
    const dx = (width - line.mainBox.width) / 2 - line.mainBox.x;
    const dy = index * lineHeight * 1.35 - line.mainBox.y;
    minY = Math.min(minY, line.inkBox.y + dy); maxY = Math.max(maxY, line.inkBox.y + line.inkBox.height + dy);
    return line.pathData.replace(/([MLQC])([^MLQCZ]+)/g, (_all, command: string, numbers: string) => {
      const values = numbers.trim().split(/[\s,]+/).map(Number);
      return command + values.map((n, i) => Number((n + (i % 2 ? dy : dx)).toFixed(3))).join(' ');
    });
  }).join('');
  return { pathData, mainBox: { x: 0, y: 0, width, height: lineHeight * (1 + (lines.length - 1) * 1.35) },
    inkBox: { x: 0, y: minY, width, height: maxY - minY }, lineFactor: 1 + (lines.length - 1) * 1.35 };
}
export async function loadLetterContours(value: string, text: string): Promise<LetterContours> {
  const selected = resolveSignFont(value);
  const cacheKey = selected.value + '|' + text.normalize('NFC');
  const cached = contourCache.get(cacheKey); if (cached) return cached;
  let result: LetterContours;
  const lines = text.split('\n').slice(0, 2);
  if (!selected.file) result = combineLetterLines(lines.map(line => systemFontContours(selected.value.split(',')[0].replace(/"/g, ''), line, selected.weight)));
  else {
  if (!fonts.has(selected.file)) {
    const pending = fetch(import.meta.env.BASE_URL + "fonts/" + selected.file).then(async response => {
      if (!response.ok) throw new Error("Не удалось загрузить шрифт. Проверьте соединение и попробуйте ещё раз.");
      return parse(await response.arrayBuffer());
    }).catch(error => { fonts.delete(selected.file); throw error; });
    fonts.set(selected.file, pending);
  }
    const font = await fonts.get(selected.file)!;
    result = combineLetterLines(lines.map(line => contoursFromFont(font, line, selected.weight)));
  }
  if (contourCache.size >= 80) contourCache.delete(contourCache.keys().next().value!);
  contourCache.set(cacheKey, result);
  return result;
}
