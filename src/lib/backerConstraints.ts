export function backerLimits(depth: number) {
  const safeDepth = Math.max(30, Math.min(100, depth));
  return { width: 4000 - 2 * safeDepth - 50, height: 1500 - 2 * safeDepth - 50 };
}
export function constrainBacker(width: number, height: number, depth: number) {
  const limits = backerLimits(depth);
  return { width: Math.max(400, Math.min(limits.width, width)), height: Math.max(250, Math.min(limits.height, height)) };
}
export type ContentBox = { x: number; y: number; width: number; height: number };
export function containBox(box: ContentBox, container: ContentBox): ContentBox {
  return { ...box, x: Math.max(container.x, Math.min(container.x + container.width - box.width, box.x)),
    y: Math.max(container.y, Math.min(container.y + container.height - box.height, box.y)) };
}
