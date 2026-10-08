import * as THREE from 'three';

export const FACADE_RC_SCALE = 200;
export const FACADE_RC_SIZE = 22.7 * FACADE_RC_SCALE;

/** Named mesh bounds in the outer facade frame, including translated corner walls. */
function localMeshBounds(root: THREE.Object3D, inverse: THREE.Matrix4, name: string) {
  const bounds = new THREE.Box3();
  root.traverse(object => {
    if (object.name !== name) return;
    const geometry = (object as THREE.Mesh).geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (geometry.boundingBox) bounds.union(geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)));
  });
  return bounds;
}

export function facadeRcPlacement(facade: THREE.Group): { matrix: THREE.Matrix4; ground: number; front: number } | null {
  facade.updateWorldMatrix(true, true);
  const inverse = facade.matrixWorld.clone().invert();
  const primary = facade.getObjectByName('facade-front') ?? facade;
  const wall = localMeshBounds(primary, inverse, 'facade-wall');
  const pavement = localMeshBounds(primary, inverse, 'facade-pavement');
  const courtyard = localMeshBounds(facade, inverse, 'facade-pavement');
  if (wall.isEmpty() || pavement.isEmpty() || courtyard.isEmpty()) return null;
  const center = new THREE.Vector3(wall.max.x - 650, pavement.max.y, courtyard.max.z + 160 + FACADE_RC_SIZE / 2);
  const local = new THREE.Matrix4().compose(center, new THREE.Quaternion(), new THREE.Vector3().setScalar(FACADE_RC_SCALE));
  return { matrix: facade.matrixWorld.clone().multiply(local), ground: pavement.max.y, front: courtyard.max.z };
}
