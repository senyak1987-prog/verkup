import { CHECKPOINTS, OBSTACLES, terrainHeight } from './terrain';
import type { RcArenaBounds, Vec2 } from './physics';
import type { RcPropSpec } from './propsPhysics';

export interface RcFloorRegion extends RcArenaBounds {}
export interface RcPlatform extends RcFloorRegion { name: string; height: number }
export interface RcPavingRegion extends RcFloorRegion { baseHeight: number }
export type RcGroundKind = 'sand' | 'pavers';
export interface RcSurface {
  /** Physical extent of the arena, in arena-local units. */
  width: number;
  depth: number;
  bounds: RcArenaBounds;
  height(x: number, z: number): number;
  checkpoints: Vec2[];
  props: RcPropSpec[];
  spawn: { x: number; z: number; yaw: number };
  /** Render only these new ground regions; existing architectural surfaces stay visible. */
  floorRegions?: RcFloorRegion[];
  /** Architectural tops, sampled by both wheel contacts and loose rigid bodies. */
  platforms?: RcPlatform[];
  /** Existing solid architecture which cannot be driven through. */
  barriers?: RcPlatform[];
  paving?: RcPavingRegion[];
  groundKind?(x: number, z: number): RcGroundKind;
}

export const PAVER_WIDTH = .62, PAVER_DEPTH = .38;
export function pavingCell(x: number, z: number) {
  const row = Math.floor(z / PAVER_DEPTH), offset = (row & 1) * PAVER_WIDTH / 2;
  const col = Math.floor((x - offset) / PAVER_WIDTH);
  const cx = (col + .5) * PAVER_WIDTH + offset, cz = (row + .5) * PAVER_DEPTH;
  const variation = (Math.sin(col * 73.31 + row * 41.17) * 43758.5453) % 1;
  const top = .027 + variation * .009;
  const edge = Math.min(PAVER_WIDTH / 2 - Math.abs(x - cx), PAVER_DEPTH / 2 - Math.abs(z - cz));
  return { cx, cz, top, height: top * Math.max(0, Math.min(1, edge / .022)) };
}
export const inRegion = (region: RcFloorRegion, x: number, z: number) =>
  x >= region.minX && x <= region.maxX && z >= region.minZ && z <= region.maxZ;

/** Loose workshop props, spaced around the perimeter with a clear start lane. */
export function workshopProps(height: RcSurface['height'], bounds: RcArenaBounds, back: number): RcPropSpec[] {
  const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - back;
  const props: RcPropSpec[] = [];
  for (const side of [-1, 1]) {
    const x = side * width * .30, z = back + depth * .44;
    for (let column = 0; column < 2; column++) for (let level = 0; level < 3; level++) {
      const px = x + column * .9;
      props.push({ id: `crate-${side}-${column}-${level}`, kind: 'crate', x: px, z,
        radius: .36, height: .66, y: height(px, z) + .33 + level * .68, mass: .38 });
    }
    for (let i = 0; i < 3; i++) props.push({ id: `barrel-${side}-${i}`, kind: 'barrel',
      x: side * width * .34 + i * .85, z: back + depth * .70, radius: .31, height: .86, mass: .5 });
    for (let i = 0; i < 3; i++) props.push({ id: `extra-cone-${side}-${i}`, kind: 'cone',
      x: side * width * .22, z: back + depth * (.18 + i * .09), radius: .24, height: .57, mass: .12 });
  }
  for (let i = 0; i < 4; i++) props.push({ id: `ball-${i}`, kind: 'ball',
    x: (i - 1.5) * 2.4, z: back + depth * .56, radius: .28, height: .56, mass: .09 });
  return props;
}

/** Reusable, physical props; each tyre in a pile is an independent rigid body. */
export function rcSurfaceProps(height: RcSurface['height'], checkpoints: Vec2[],
  tirePiles: Array<{ x: number; z: number; radius: number }>, cones: Vec2[]): RcPropSpec[] {
  const props: RcPropSpec[] = [];
  tirePiles.forEach((pile, index) => {
    for (let level = 0; level < 3; level++) props.push({
      id: `tire-${index}-${level}`, kind: 'tire', x: pile.x, z: pile.z,
      y: height(pile.x, pile.z) + .085 + level * .175,
      radius: .3050205484, height: .17, mass: .48,
    });
  });
  cones.forEach((point, index) => props.push({
    id: `cone-${index}`, kind: 'cone', ...point, radius: .24, height: .57, mass: .12,
  }));
  checkpoints.forEach((point, index) => {
    const next = checkpoints[(index + 1) % checkpoints.length];
    const angle = Math.atan2(next.x - point.x, next.z - point.z);
    for (const side of [-1, 1]) props.push({
      id: `bollard-${index}-${side}`, kind: 'bollard',
      x: point.x + Math.cos(angle) * side * 1.1,
      z: point.z - Math.sin(angle) * side * 1.1,
      radius: .15, height: .87, mass: .22,
    });
  });
  return props;
}

export function createDefaultRcSurface(): RcSurface {
  const checkpoints = CHECKPOINTS.map(point => ({ ...point }));
  const bounds = { minX: -10.5, maxX: 10.5, minZ: -10.5, maxZ: 10.5 };
  const paving = [{ minX: -10.5, maxX: 10.5, minZ: -10.5, maxZ: -7.8, baseHeight: 0 }];
  const height = (x: number, z: number) => terrainHeight(x, z) + (inRegion(paving[0], x, z) ? pavingCell(x, z).height : 0);
  return {
    width: 22.7, depth: 22.7,
    bounds, height, paving,
    groundKind: (x, z) => inRegion(paving[0], x, z) ? 'pavers' : 'sand',
    checkpoints,
    props: [...rcSurfaceProps(height, checkpoints, OBSTACLES, [
      { x: 8, z: 0 }, { x: -8, z: -5 }, { x: 3, z: -7 }, { x: -3, z: 6.5 },
    ]), ...workshopProps(height, bounds, bounds.minZ)],
    spawn: { x: 0, z: 3.6, yaw: Math.PI / 2 },
  };
}
