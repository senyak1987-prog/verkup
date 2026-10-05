export function allowedLetterDepths(heightMm: number): number[] {
  const result: number[] = [];
  if (heightMm <= 180) result.push(40);
  if (heightMm >= 120 && heightMm <= 350) result.push(50);
  if (heightMm >= 200 && heightMm <= 550) result.push(60);
  return result;
}
export function normalizeLetterDepth(heightMm: number, depthMm: number) {
  const allowed = allowedLetterDepths(heightMm);
  return allowed.includes(depthMm) ? depthMm : allowed[allowed.length - 1] ?? 60;
}
export function frameRailCenters(top: number, height: number, topInset: number, bottomInset: number) {
  return { top: top + Math.min(20, Math.max(10, topInset)) + 7.5,
    bottom: top + height - Math.min(20, Math.max(10, bottomInset)) - 7.5 };
}
