import { CHECKPOINTS, OBSTACLES, terrainHeight } from './terrain';
import type { RcArenaBounds, Vec2 } from './physics';
import type { RcPropSpec } from './propsPhysics';

export interface RcFloorRegion extends RcArenaBounds {}
export interface RcPlatform extends RcFloorRegion { name: string; height: number }
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
}

/** Reusable, physical props; each tyre in a pile is an independent rigid body. */
export function rcSurfaceProps(height: RcSurface['height'], checkpoints: Vec2[],
  tirePiles: Array<{ x: number; z: number; radius: number }>, cones: Vec2[]): RcPropSpec[] {
  const props: RcPropSpec[] = [];
  tirePiles.forEach((pile, index) => {
    for (let level = 0; level < 3; level++) props.push({
      id: `tire-${index}-${level}`, kind: 'tire', x: pile.x, z: pile.z,
      y: height(pile.x, pile.z) + .12 + level * .245,
      radius: pile.radius, height: .24, mass: .48,
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
  return {
    width: 22.7, depth: 22.7,
    bounds: { minX: -10.5, maxX: 10.5, minZ: -10.5, maxZ: 10.5 },
    height: terrainHeight,
    checkpoints,
    props: rcSurfaceProps(terrainHeight, checkpoints, OBSTACLES, [
      { x: 8, z: 0 }, { x: -8, z: -5 }, { x: 3, z: -7 }, { x: -3, z: 6.5 },
    ]),
    spawn: { x: 0, z: 3.6, yaw: Math.PI / 2 },
  };
}
