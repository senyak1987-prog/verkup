export function allowedLetterDepths(heightMm: number | readonly number[]): number[] {
  if (Array.isArray(heightMm)) return [40,50,60].filter(depth=>heightMm.every(height=>allowedLetterDepths(height).includes(depth)));
  const height = heightMm as number;
  const result: number[] = [];
  if (height <= 180) result.push(40);
  if (height >= 120 && height <= 350) result.push(50);
  if (height >= 200 && height <= 550) result.push(60);
  return result;
}
export function normalizeLetterDepth(heightMm: number | readonly number[], depthMm: number) {
  const allowed = allowedLetterDepths(heightMm);
  return allowed.includes(depthMm) ? depthMm : allowed[allowed.length - 1] ?? 60;
}
export function frameRailCenters(top: number, height: number, topInset: number, bottomInset: number) {
  return { top: top + Math.min(20, Math.max(10, topInset)) + 7.5,
    bottom: top + height - Math.min(20, Math.max(10, bottomInset)) - 7.5 };
}
