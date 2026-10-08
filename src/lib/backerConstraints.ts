export function backerLimits(depth: number) {
  const safeDepth = Math.max(30, Math.min(100, depth));
  return { width: 4000 - 2 * safeDepth - 50, height: 1500 - 2 * safeDepth - 50 };
}
export function constrainBacker(width: number, height: number, depth: number) {
  const limits = backerLimits(depth);
  return { width: Math.max(400, Math.min(20000, width)), height: Math.max(250, Math.min(limits.height, height)) };
}
export type ContentBox = { x: number; y: number; width: number; height: number };
export function containBox(box: ContentBox, container: ContentBox): ContentBox {
  return { ...box, x: Math.max(container.x, Math.min(container.x + container.width - box.width, box.x)),
    y: Math.max(container.y, Math.min(container.y + container.height - box.height, box.y)) };
}

/** Each joined tray includes its own depth folds and two 25 mm returns. */
export function backerSeams(width:number,depth:number):number[]{
  const count=Math.max(1,Math.ceil(width/backerLimits(depth).width));
  return Array.from({length:count-1},(_,i)=>width*(i+1)/count);
}
