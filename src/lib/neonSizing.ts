import { createNeonDesign, neonRequiredBacker } from './neonConstruction';
import type { NeonDesign, NeonDesignOptions } from './neonConstruction';

type Measure = (height: number) => NeonDesign;
function minimumHeight(measure: Measure) {
  try { measure(40); return 40; } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Увеличьте высоту')) throw error;
  }
  measure(800);
  let low = 40, high = 800;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    try { measure(mid); high = mid; } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('Увеличьте высоту')) throw error;
      low = mid;
    }
  }
  return high;
}

/** Solve with fixed physical spacing instead of assuming every dimension scales with the text. */
export function fitNeonToWidth(text: string, width: number, diameter: number, font: string, align = 'center', options: NeonDesignOptions = {}) {
  if (!Number.isFinite(width) || width <= 0) throw new Error('Укажите ширину неоновой надписи.');
  const natural = { ...options, targetWidth: undefined };
  const measure = (height: number) => createNeonDesign(text, height, diameter, font, align, natural);
  let low = minimumHeight(measure), high = 800;
  const minimum = measure(low);
  if (minimum.width > width + 1) throw new Error(`Для этого текста и неона нужна ширина не меньше ${Math.ceil(minimum.width)} мм. Увеличьте ширину или уменьшите интервалы.`);
  const maximum = measure(high);
  if (maximum.width < width - 1) throw new Error(`Для этой надписи максимальная ширина с сохранением пропорций — ${Math.floor(maximum.width)} мм. Уменьшите ширину или отключите сохранение пропорций.`);
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (measure(mid).width < width) low = mid; else high = mid;
  }
  const a = measure(low), b = measure(high), height = Math.abs(a.width - width) <= Math.abs(b.width - width) ? low : high;
  const design = height === low ? a : b;
  return { height, design, backer: neonRequiredBacker(design) };
}

export function suggestNeonSizes(text: string, diameter: number, font: string, align = 'center', options: NeonDesignOptions = {}) {
  if (!text.trim()) return [];
  const measure = (height: number) => createNeonDesign(text, height, diameter, font, align, { ...options, targetWidth: undefined });
  try {
    const compact = Math.max(80, Math.ceil(minimumHeight(measure) / 10) * 10);
    const heights = [compact, Math.ceil(compact * 1.6 / 10) * 10, Math.ceil(compact * 2.4 / 10) * 10];
    return heights.filter(height => height <= 800).map(height => {
      const design = measure(height), backer = neonRequiredBacker(design);
      return { height, width: design.width, designHeight: design.height, backerWidth: Math.max(150, backer.width), backerHeight: Math.max(150, backer.height) };
    }).filter(size => size.width <= 3800 && size.backerWidth <= 3950 && size.backerHeight <= 1450);
  } catch { return []; }
}
