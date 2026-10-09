import * as THREE from 'three';
import { rcSurfaceProps, workshopProps, pavingCell, inRegion, type RcPlatform, type RcSurface } from './terrainSurface';

export const FACADE_RC_SCALE = 200;
/** Kept for standalone embedding; facade arenas now follow their real building width. */
export const FACADE_RC_SIZE = 22.7 * FACADE_RC_SCALE;
const APRON_DEPTH = 4400;

/** Named mesh bounds in the outer facade frame, including translated corner walls. */
function localMeshBounds(root: THREE.Object3D, inverse: THREE.Matrix4, name: string) {
  const bounds = new THREE.Box3();
  root.traverse(object => {
    if (object.name !== name) return;
    bounds.union(meshBounds(object, inverse));
  });
  return bounds;
}

function meshBounds(object: THREE.Object3D, inverse: THREE.Matrix4) {
  const geometry = (object as THREE.Mesh).geometry;
  if (!geometry) return new THREE.Box3();
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  return geometry.boundingBox?.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)) ?? new THREE.Box3();
}

export interface FacadeRcPlacement {
  matrix: THREE.Matrix4;
  ground: number;
  front: number;
  surface: RcSurface;
}

export function facadeRcPlacement(facade: THREE.Group): FacadeRcPlacement | null {
  facade.updateWorldMatrix(true, true);
  const inverse = facade.matrixWorld.clone().invert();
  const primary = facade.getObjectByName('facade-front') ?? facade;
  const wall = localMeshBounds(primary, inverse, 'facade-wall');
  const pavement = localMeshBounds(primary, inverse, 'facade-pavement');
  const courtyard = localMeshBounds(facade, inverse, 'facade-pavement');
  if (wall.isEmpty() || pavement.isEmpty() || courtyard.isEmpty()) return null;

  // The complete front wall determines the playground width. Its rear edge reaches
  // the shop frontage, so the existing pavement and entrance staircase are driveable.
  const rear = wall.max.z + 80, front = courtyard.max.z;
  const center = new THREE.Vector3((wall.min.x + wall.max.x) / 2, pavement.max.y, (rear + front + APRON_DEPTH) / 2);
  const width = (wall.max.x - wall.min.x) / FACADE_RC_SCALE;
  const depth = (front + APRON_DEPTH - rear) / FACADE_RC_SCALE;
  const toX = (value: number) => (value - center.x) / FACADE_RC_SCALE;
  const toZ = (value: number) => (value - center.z) / FACADE_RC_SCALE;
  const bounds = { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 };
  const platforms: RcPlatform[] = [], barriers: RcPlatform[] = [];
  facade.traverse(object => {
    const walkable = object.name === 'facade-pavement' || object.name.startsWith('facade-entrance-step-') || object.name === 'facade-entrance-threshold';
    const solid = object.name === 'facade-planter-box' || object.name.startsWith('facade-canopy-column-');
    if (!walkable && !solid) return;
    const box = meshBounds(object, inverse);
    if (box.isEmpty()) return;
    const region: RcPlatform = {
      name: object.name, minX: Math.max(bounds.minX, toX(box.min.x)), maxX: Math.min(bounds.maxX, toX(box.max.x)),
      minZ: Math.max(bounds.minZ, toZ(box.min.z)), maxZ: Math.min(bounds.maxZ, toZ(box.max.z)),
      height: (box.max.y - center.y) / FACADE_RC_SCALE,
    };
    if (region.maxX <= region.minX || region.maxZ <= region.minZ) return;
    (walkable ? platforms : barriers).push(region);
  });
  const apronBack = toZ(front);
  const paving = [
    ...platforms.filter(top => top.name === 'facade-pavement').map(top => ({ ...top, baseHeight: top.height })),
    { minX: bounds.minX, maxX: bounds.maxX, minZ: apronBack, maxZ: apronBack + 3.8, baseHeight: 0 },
  ];
  const height = (x: number, z: number) => {
    let y = 0;
    for (const top of platforms) if (x >= top.minX && x <= top.maxX && z >= top.minZ && z <= top.maxZ) y = Math.max(y, top.height);
    const patch = paving.find(region => inRegion(region, x, z));
    if (patch && y <= patch.baseHeight + .001) y = patch.baseHeight + pavingCell(x, z).height;
    // Low sand ripples flank the clear racing lane, without covering the steps.
    if (!patch && z > apronBack && Math.abs(x) > width * .23) y += .065 * (1 + Math.sin(x * 1.3 + z * .8))
      * Math.min(1, (Math.abs(x) - width * .23) / 1.2);
    return y;
  };
  const loopBack = apronBack + 3.2, loopFront = bounds.maxZ - 3.2, loopSide = width / 2 - 4;
  const checkpoints = [
    { x: loopSide, z: loopFront }, { x: loopSide, z: loopBack }, { x: 0, z: loopBack },
    { x: -loopSide, z: loopBack }, { x: -loopSide, z: loopFront }, { x: 0, z: loopFront },
  ];
  const middleZ = (loopBack + loopFront) / 2;
  const surface: RcSurface = {
    width, depth, bounds, height, platforms, barriers, paving,
    groundKind: (x, z) => paving.some(region => inRegion(region, x, z)) ? 'pavers' : 'sand',
    floorRegions: [{ minX: bounds.minX, maxX: bounds.maxX, minZ: apronBack, maxZ: bounds.maxZ }],
    checkpoints,
    props: [...rcSurfaceProps(height, checkpoints, [
      { x: width * .16, z: middleZ, radius: .65 }, { x: -width * .16, z: middleZ - 1.8, radius: .65 },
      { x: -1.5, z: middleZ + 1.6, radius: .45 },
    ], [
      { x: loopSide + 1.9, z: middleZ }, { x: -loopSide - 1.9, z: loopBack + 1.4 },
      { x: 3, z: apronBack + 1.4 }, { x: -3, z: bounds.maxZ - 1.6 },
    ]), ...workshopProps(height, bounds, apronBack)],
    spawn: { x: 0, z: loopFront, yaw: Math.PI / 2 },
  };
  const local = new THREE.Matrix4().compose(center, new THREE.Quaternion(), new THREE.Vector3().setScalar(FACADE_RC_SCALE));
  return { matrix: facade.matrixWorld.clone().multiply(local), ground: pavement.max.y, front, surface };
}
