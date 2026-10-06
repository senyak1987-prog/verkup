import * as THREE from 'three';
export { zoomFocusWeight } from './signZoomFocus';

const EXCLUDED_FOCUS_NAMES = new Set([
  'dimensions', 'photo-facade', 'panel-mount-context',
  'rear-halo-projection', 'face-light-aura',
  'neon-light-spill', 'neon-light-core', 'neon-core-end',
]);

function excludedFromFocus(object: THREE.Object3D) {
  return EXCLUDED_FOCUS_NAMES.has(object.name) || object.name === 'facade' || object.name.startsWith('facade-');
}

/** Only this drawable's geometry, preserving all parent world transforms and excluding its optical children. */
function drawableBounds(object: THREE.Object3D) {
  const geometry = (object as THREE.Mesh).geometry;
  if (!geometry?.isBufferGeometry) return new THREE.Box3();
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  return geometry.boundingBox ? geometry.boundingBox.clone().applyMatrix4(object.matrixWorld) : new THREE.Box3();
}

/** The physical sign, rather than facade, annotations, mounting context or emitted light, sets the zoom focus. */
export function signFocusBounds(model: THREE.Object3D): THREE.Box3 {
  model.updateWorldMatrix(true, true);
  const panel = model.getObjectByName('panel-body');
  if (panel) return drawableBounds(panel);
  const neonBacker = model.getObjectByName('transparent-acrylic-backer');
  if (neonBacker) return drawableBounds(neonBacker);

  const bounds = new THREE.Box3();
  const visit = (object: THREE.Object3D) => {
    if (excludedFromFocus(object)) return;
    bounds.union(drawableBounds(object));
    for (const child of object.children) visit(child);
  };
  visit(model);
  return bounds;
}
