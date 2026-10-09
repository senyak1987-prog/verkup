import * as THREE from 'three';
export { zoomFocusWeight } from './signZoomFocus';

// Dimension textures use a 42 px font on a 64 px canvas. Keep the displayed font at 14 CSS px.
export const DIMENSION_LABEL_HEIGHT_PX = 14 * 64 / 42;

/** Orthographic zoom changes the model size, while measurement labels retain their screen size. */
export function scaleDimensionLabels(labels: readonly THREE.Sprite[], camera: THREE.OrthographicCamera, viewportHeight: number) {
  if (viewportHeight <= 0 || camera.zoom <= 0) return;
  camera.updateMatrixWorld();
  const height = DIMENSION_LABEL_HEIGHT_PX * (camera.top - camera.bottom) / (viewportHeight * camera.zoom);
  const viewportWidth = viewportHeight * (camera.right - camera.left) / (camera.top - camera.bottom);
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  labels: for (const label of labels) {
    label.scale.set(height * label.userData.labelAspect, height, 1);
    for (let ancestor: THREE.Object3D | null = label; ancestor; ancestor = ancestor.parent) {
      if (!ancestor.visible) continue labels;
    }
    const origin = label.userData.labelPosition as THREE.Vector3 | undefined;
    const anchor = label.userData.labelAnchor as THREE.Vector3 | undefined;
    if (!origin || !anchor) continue;
    label.position.copy(origin);
    const point = label.getWorldPosition(new THREE.Vector3()).project(camera);
    const line = (label.parent ? label.parent.localToWorld(anchor.clone()) : anchor.clone()).project(camera);
    let x = (point.x + 1) * viewportWidth / 2, y = (1 - point.y) * viewportHeight / 2;
    const dx = (point.x - line.x) * viewportWidth / 2, dy = (line.y - point.y) * viewportHeight / 2;
    const distance = Math.hypot(dx, dy), width = DIMENSION_LABEL_HEIGHT_PX * label.userData.labelAspect;
    // Leave room for the readable label even when its physical offset shrinks during zoom-out.
    if (distance > 1e-7) {
      const clearance = (Math.abs(dx) * width + Math.abs(dy) * DIMENSION_LABEL_HEIGHT_PX) / (2 * distance) + 5;
      const extra = Math.max(0, clearance - distance);
      x += dx / distance * extra; y += dy / distance * extra;
    }
    let rect = { left: x - width / 2, right: x + width / 2, top: y - DIMENSION_LABEL_HEIGHT_PX / 2, bottom: y + DIMENSION_LABEL_HEIGHT_PX / 2 };
    for (let pass = 0; pass < placed.length; pass++) {
      const overlap = placed.find(other => rect.left < other.right + 4 && rect.right > other.left - 4 && rect.top < other.bottom + 4 && rect.bottom > other.top - 4);
      if (!overlap) break;
      const shift = overlap.bottom + 4 - rect.top;
      y += shift; rect = { ...rect, top: rect.top + shift, bottom: rect.bottom + shift };
    }
    placed.push(rect);
    point.set(x / viewportWidth * 2 - 1, 1 - y / viewportHeight * 2, point.z).unproject(camera);
    label.position.copy(label.parent ? label.parent.worldToLocal(point) : point);
  }
}

const EXCLUDED_FOCUS_NAMES = new Set([
  'dimensions', 'photo-facade', 'panel-mount-context', 'scale-person', 'companion-sign',
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
  const configured = model.getObjectByName('primary-sign') ?? model;
  const primary = configured.visible ? configured : model.getObjectByName('companion-sign') ?? configured;
  if (!primary.visible) return new THREE.Box3();
  const panel = primary.getObjectByName('panel-body');
  if (panel) return drawableBounds(panel);
  const neonBacker = primary.getObjectByName('transparent-acrylic-backer');
  if (neonBacker) return drawableBounds(neonBacker);

  const bounds = new THREE.Box3();
  const visit = (object: THREE.Object3D) => {
    if (!object.visible || object !== primary && excludedFromFocus(object)) return;
    bounds.union(drawableBounds(object));
    for (const child of object.children) visit(child);
  };
  visit(primary);
  return bounds;
}
