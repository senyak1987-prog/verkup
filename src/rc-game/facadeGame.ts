import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createRcWorld, type RcMode, type RcTelemetry } from './world';
import type { CarInput } from './physics';
import { facadeRcPlacement } from './facadePlacement';

export type FacadeRcCamera = 'arena' | 'car' | 'rear';
export interface FacadeRcGame {
  group: THREE.Group;
  active: boolean;
  paused: boolean;
  available: boolean;
  setFacade(facade: THREE.Group | null): void;
  start(): void; exit(): void; reset(): void;
  setPaused(value: boolean): void;
  setMode(value: RcMode): void;
  setCamera(value: FacadeRcCamera): void;
  setLighting(night: number): void;
  resize(): void;
  update(now: number): boolean;
  suspend(): void;
  dispose(): void;
}

type Options = {
  scene: THREE.Scene; camera: THREE.OrthographicCamera; controls: OrbitControls;
  canvas: HTMLCanvasElement; requestRender(): void;
  onActive(value: boolean): void; onTelemetry(value: RcTelemetry): void;
  onGeometryChange?(): void;
};

/** RC input and camera takeover for an existing renderer; never creates another canvas. */
export function createFacadeRcGame(options: Options): FacadeRcGame {
  const { scene, camera, controls, canvas, requestRender } = options;
  let world = createRcWorld();
  const group = new THREE.Group(); group.name='rc-facade-playground';group.add(world.group);
  group.visible = false;
  group.traverse(object => object.layers.set(1));
  scene.add(group);
  camera.layers.enable(1);
  // Camera layers do not scope Three.js lights to individual objects. A small
  // emissive lift keeps only these toy materials readable in the existing night scene.
  const nightMaterials = new Map<THREE.MeshStandardMaterial, { emissive: THREE.Color; intensity: number }>();
  function collectMaterials() { group.traverse(object => {
    object.layers.set(1);
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const item of Array.isArray(material) ? material : [material]) {
      const lit = item as THREE.MeshStandardMaterial;
      if (lit.emissive && !nightMaterials.has(lit)) nightMaterials.set(lit, { emissive: lit.emissive.clone(), intensity: lit.emissiveIntensity });
    }
  }); }
  collectMaterials();
  const signalController = new AbortController(); const signal = signalController.signal;
  const keys = new Set<string>();
  const pointer = new THREE.Vector2(); let hasPointer = false, pressed = false, braking = false, pointerId: number | null = null;
  const raycaster = new THREE.Raycaster(), plane = new THREE.Plane(), intersection = new THREE.Vector3();
  let disposed = false, lastTime = 0, lastTelemetry = 0, nightFraction = -1;
  let view: FacadeRcCamera = 'arena';
  let currentMode: RcMode = 'free';
  let snapshot: { position: THREE.Vector3; quaternion: THREE.Quaternion; up: THREE.Vector3; target: THREE.Vector3;
    left: number; right: number; top: number; bottom: number; zoom: number; near: number; far: number; enabled: boolean;
    width: number; height: number } | null = null;
  const NEUTRAL: CarInput = { target: null, throttle: 0, brake: false, reverse: false };

  function emit() { options.onTelemetry(world.getTelemetry(game.paused, pressed || keys.has('w') || keys.has('arrowup') || keys.has('s') || keys.has('arrowdown'))); }
  function geometryChanged() { options.onGeometryChange?.(); requestRender(); }
  function clearInput() {
    pressed = braking = hasPointer = false; keys.clear();
    if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = null;
  }
  function point(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); hasPointer = true;
  }
  function input(): CarInput {
    let target = null;
    if (hasPointer) {
      const origin = group.getWorldPosition(new THREE.Vector3());
      plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0,1,0).transformDirection(group.matrixWorld), origin);
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(plane, intersection)) {
        group.worldToLocal(intersection);
        const bounds=world.surface.bounds;
        target = { x: THREE.MathUtils.clamp(intersection.x, bounds.minX+.7, bounds.maxX-.7),
          z: THREE.MathUtils.clamp(intersection.z, bounds.minZ+1, bounds.maxZ-1) };
      }
    }
    const keyboardDrive = keys.has('w') || keys.has('arrowup') || keys.has('s') || keys.has('arrowdown');
    const steer = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    return { target: keyboardDrive ? null : target, throttle: pressed || keyboardDrive ? 1 : 0, brake: braking || keys.has(' '),
      reverse: keys.has('shift') || keys.has('s') || keys.has('arrowdown'), steer: keyboardDrive ? steer : undefined };
  }
  function frameGame() {
    if (!game.active || !game.available) return;
    group.updateWorldMatrix(true, true);
    const physicalScale = group.getWorldScale(new THREE.Vector3()).x;
    const carPosition = group.localToWorld(new THREE.Vector3(world.physics.state.x, world.physics.state.y, world.physics.state.z));
    const close=view==='car'||view==='rear';
    const target = close ? carPosition.add(new THREE.Vector3(0, physicalScale * .35, 0))
      : group.localToWorld(new THREE.Vector3(0, 8, -3));
    const direction = view==='rear'
      ? new THREE.Vector3(-Math.sin(world.physics.state.yaw),.35,-Math.cos(world.physics.state.yaw)).transformDirection(group.matrixWorld)
      : new THREE.Vector3(.45, view === 'car' ? .55 : .95, 1).normalize();
    const aspect = Math.max(.25, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    const viewHeight = close ? Math.max(physicalScale * (view==='rear'?3.7:5), physicalScale * 6 / aspect)
      : Math.max(physicalScale * (world.surface.depth+24), physicalScale * (world.surface.width+8) / aspect);
    camera.left = -viewHeight * aspect / 2; camera.right = -camera.left;
    camera.top = viewHeight / 2; camera.bottom = -camera.top; camera.zoom = 1;
    camera.position.copy(target).addScaledVector(direction, Math.max(18000, viewHeight * 3));
    controls.target.copy(target); camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
  canvas.addEventListener('pointerdown', event => {
    if (!game.active || game.paused || pointerId !== null && pointerId !== event.pointerId) return;
    event.preventDefault(); canvas.focus({ preventScroll: true }); point(event);
    pointerId = event.pointerId; canvas.setPointerCapture(event.pointerId);
    pressed = event.button === 0; braking = event.button === 2;
  }, { signal });
  canvas.addEventListener('pointermove', event => {
    if (!game.active || pointerId !== null && pointerId !== event.pointerId) return;
    point(event); if (event.pointerType === 'mouse' && pointerId !== null) { pressed = !!(event.buttons & 1); braking = !!(event.buttons & 2); }
    requestRender();
  }, { signal });
  canvas.addEventListener('mousedown', event => { if (game.active && !game.paused) { pressed = !!(event.buttons & 1); braking = !!(event.buttons & 2); } }, { signal });
  canvas.addEventListener('mouseup', event => { if (game.active) { pressed = !!(event.buttons & 1); braking = !!(event.buttons & 2); } }, { signal });
  canvas.addEventListener('pointerup', event => { if (game.active && event.pointerId === pointerId) clearInput(); }, { signal });
  canvas.addEventListener('pointercancel', clearInput, { signal });
  canvas.addEventListener('lostpointercapture', () => { pressed = braking = false; pointerId = null; }, { signal });
  canvas.addEventListener('blur', clearInput, { signal });
  canvas.addEventListener('contextmenu', event => { if (game.active) event.preventDefault(); }, { signal });
  canvas.addEventListener('keydown', event => {
    if (!game.active) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); game.exit(); return; }
    const key = event.key.toLowerCase();
    if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' ','shift'].includes(key)) {
      event.preventDefault(); event.stopPropagation(); keys.add(key); requestRender();
    }
  }, { signal });
  canvas.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()), { signal });
  document.addEventListener('visibilitychange', () => { clearInput(); lastTime = 0; }, { signal });
  window.addEventListener('blur', clearInput, { signal });
  const originalTabIndex = canvas.getAttribute('tabindex');

  const game: FacadeRcGame = {
    group, active: false, paused: false, available: false,
    setFacade(facade) {
      if (disposed) return;
      if (game.active) game.exit();
      const placement = facade ? facadeRcPlacement(facade) : null;
      game.available = !!placement; group.visible = game.available;
      if (placement) {
        world.dispose();nightMaterials.clear();world=createRcWorld({surface:placement.surface});
        group.add(world.group);collectMaterials();world.setMode(currentMode);
        const lighting=nightFraction;nightFraction=-1;game.setLighting(Math.max(0,lighting));
        scene.updateWorldMatrix(true, false);
        const local = scene.matrixWorld.clone().invert().multiply(placement.matrix);
        local.decompose(group.position, group.quaternion, group.scale); group.updateWorldMatrix(true, true);
      }
      world.reset(); world.update(NEUTRAL, 0, false); emit(); geometryChanged();
    },
    start() {
      if (disposed || game.active || !game.available) return;
      snapshot = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), up: camera.up.clone(), target: controls.target.clone(),
        left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom, zoom: camera.zoom, near: camera.near, far: camera.far, enabled: controls.enabled,
        width: Math.max(1, canvas.clientWidth), height: Math.max(1, canvas.clientHeight) };
      game.active = true; game.paused = false; controls.enabled = false; clearInput(); lastTime = 0;
      frameGame(); options.onActive(true); emit(); canvas.tabIndex = 0; canvas.focus({ preventScroll: true }); geometryChanged();
    },
    exit() {
      if (!game.active) return;
      game.active = false; game.paused = false; clearInput(); lastTime = 0;
      world.update(NEUTRAL, 0, false);
      if (snapshot) {
        Object.assign(camera, { left: snapshot.left, right: snapshot.right, top: snapshot.top, bottom: snapshot.bottom, zoom: snapshot.zoom, near: snapshot.near, far: snapshot.far });
        const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
        if (width !== snapshot.width || height !== snapshot.height) {
          const center = (snapshot.left + snapshot.right) / 2;
          const halfWidth = (snapshot.top - snapshot.bottom) * width / height / 2;
          camera.left = center - halfWidth; camera.right = center + halfWidth;
        }
        camera.position.copy(snapshot.position); camera.quaternion.copy(snapshot.quaternion); camera.up.copy(snapshot.up);
        controls.target.copy(snapshot.target); controls.enabled = snapshot.enabled; camera.updateProjectionMatrix(); camera.updateMatrixWorld(); snapshot = null;
      }
      options.onActive(false); emit(); geometryChanged();
      if (originalTabIndex === null) canvas.removeAttribute('tabindex'); else canvas.setAttribute('tabindex', originalTabIndex);
    },
    reset() { if (disposed) return; clearInput(); lastTime = 0; world.reset(); frameGame(); emit(); geometryChanged(); },
    setPaused(value) { if (disposed) return; game.paused = value; clearInput(); lastTime = 0; emit(); geometryChanged(); },
    setMode(value) { if (disposed) return; currentMode=value;clearInput(); lastTime = 0; world.setMode(value); frameGame(); emit(); geometryChanged(); },
    setCamera(value) { if (disposed) return; view = value; clearInput(); frameGame(); geometryChanged(); },
    setLighting(night) {
      if (disposed) return;
      const fraction = Number.isFinite(night) ? THREE.MathUtils.clamp(night, 0, 1) : 0;
      if (fraction === nightFraction) return;
      nightFraction = fraction;
      nightMaterials.forEach((original, material) => {
        material.emissive.copy(original.emissive);
        if (fraction === 0) material.emissiveIntensity = original.intensity;
        else {
          material.emissive.multiplyScalar(original.intensity).add(material.color.clone().multiplyScalar(fraction * .08));
          material.emissiveIntensity = 1;
        }
      });
      geometryChanged();
    },
    resize() { if (game.active) frameGame(); },
    update(now) {
      if (disposed || !game.active) { lastTime = 0; return false; }
      const dt = lastTime ? Math.min((now - lastTime) / 1000, .05) : 0; lastTime = now;
      const control = input();
      if (!game.paused) world.step(dt, control);
      world.update(control, game.paused ? 0 : dt, !game.paused);
      if (view === 'car' || view === 'rear') frameGame();
      if (now - lastTelemetry > 100) { lastTelemetry = now; emit(); }
      return !game.paused;
    },
    suspend() { clearInput(); lastTime = 0; },
    dispose() {
      if (disposed) return; game.exit(); disposed = true; signalController.abort(); clearInput(); world.dispose();
      nightMaterials.clear();
      group.removeFromParent();group.clear();
      if (originalTabIndex === null) canvas.removeAttribute('tabindex'); else canvas.setAttribute('tabindex', originalTabIndex);
    },
  };
  world.update(NEUTRAL, 0, false);
  return game;
}
