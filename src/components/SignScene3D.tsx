import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { RotateCcw, ScanLine, Sun } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { applySignLighting, buildSignModel, disposeSignObject } from "../lib/signSceneGeometry";
import type { SignSceneLayout, SignSceneProject } from "../lib/signSceneGeometry";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { attachFacadePair, createFacadeModel, createPanelMountContext, createScalePerson, loadScalePersonBrand, setFacadeProductVisibility } from "../lib/signFacade3D";
import { DAYLIGHT_LEVELS, daylightSource } from "../lib/signDaylight";
import { signFocusBounds, zoomFocusWeight } from "../lib/signCameraFocus";
import type { DaylightMarker } from "../lib/signDaylight";
import { sceneLightingAt, sceneLightingDuration } from "../lib/sceneLighting";
import { panelMountLayout } from "../lib/panelConstruction";
import type { SignPlacement } from "../lib/signFacade";
import "../sign-scene-3d.css";

export type { SignSceneLayout, SignSceneProject } from "../lib/signSceneGeometry";
export type SignScene3DProps = {
  project: SignSceneProject;
  layout: SignSceneLayout;
  width: number;
  height: number;
  depth: number;
  showDimensions: boolean;
  zoom: number;
  placement?: SignPlacement;
  companion?: { project: SignSceneProject; width: number; height: number; depth: number };
  showPerson?: boolean;
  showSign?: boolean;
  showPanel?: boolean;
  onZoomChange?: (value: number) => void;
  resetKey?: number;
  onUnavailable?: () => void;
};

/** Cube shadow depth is measured along its face axis, rather than radial distance. */
export function pointShadowFrustum(bounds: THREE.Box3, position: THREE.Vector3) {
  const axisDistance = (value: number, min: number, max: number) => Math.max(min - value, value - max, 0);
  const nearest = Math.max(axisDistance(position.x, bounds.min.x, bounds.max.x),
    axisDistance(position.y, bounds.min.y, bounds.max.y), axisDistance(position.z, bounds.min.z, bounds.max.z));
  const farthest = Math.max(Math.abs(position.x - bounds.min.x), Math.abs(position.x - bounds.max.x),
    Math.abs(position.y - bounds.min.y), Math.abs(position.y - bounds.max.y),
    Math.abs(position.z - bounds.min.z), Math.abs(position.z - bounds.max.z), 1);
  const near = Math.max(1, nearest * .8), far = Math.max(near + 1, farthest * 1.08);
  // A 0.35 mm depth offset stays physical when the scene or camera range changes.
  const bias = -.35 * near * far / ((far - near) * farthest * farthest);
  return { near, far, bias };
}

type SceneRuntime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  model: THREE.Group | null;
  ambient: THREE.HemisphereLight;
  key: THREE.PointLight;
  fill: THREE.DirectionalLight;
  distance: number;
  requestRender: () => void;
  frame: (front: boolean, preserveOrbit?: boolean) => void;
  resize: () => void;
  fitToView: () => void;
  bounds: THREE.Box3;
  fitCenter: THREE.Vector3;
  signAnchor: THREE.Vector3;
  focusZoom: () => void;
  light: (night: number, windows: number, lightsOn: boolean) => void;
  source: (marker: DaylightMarker) => void;
};

export function SignScene3D({ project, layout, width, height, depth, showDimensions, zoom, placement = 'none', companion, showPerson = true, showSign = true, showPanel = true, onZoomChange, resetKey = 0, onUnavailable }: SignScene3DProps) {
  const geometryKey = JSON.stringify({ ...project, sceneMode: undefined, lightsOn:undefined });
  const modelProject = useMemo(() => ({ ...project, sceneMode: 'night' as const, lightsOn:true }), [geometryKey]);
  const lightsOnRef=useRef(project.lightsOn!==false);
  const showPersonRef = useRef(showPerson); showPersonRef.current = showPerson;
  const visibilityRef = useRef({ showSign, showPanel }); visibilityRef.current = { showSign, showPanel };
  const companionKey = companion ? JSON.stringify({ ...companion, project: { ...companion.project, sceneMode: undefined, lightsOn: undefined } }) : '';
  const modelCompanion = useMemo(() => companion ? { ...companion, project: { ...companion.project, sceneMode: 'night' as const, lightsOn: true } } : undefined, [companionKey]);
  lightsOnRef.current=project.lightsOn!==false;
  const lightFraction = useRef(project.sceneMode === 'night' ? 1 : 0);
  const windowFraction = useRef(lightFraction.current);
  const [sunMarker, setSunMarker] = useState<DaylightMarker>({ x: .18, y: .2 });
  const sunMarkerRef = useRef(sunMarker);
  sunMarkerRef.current = sunMarker;
  const layoutRef = useRef(layout);
  const panelRef = useRef(project.productId === "panel");
  panelRef.current = project.productId === "panel" || Boolean(project.backdropImage);
  layoutRef.current = project.productId === "panel"
    ? { ...layout, viewWidth: project.panelSize * 1.8, viewHeight: project.panelSize * 1.42 }
    : project.productId === "neon" ? { ...layout, viewWidth: width * 1.1, viewHeight: height * 1.15 } : layout;
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const unavailableRef = useRef(onUnavailable);
  const zoomRef = useRef(zoom);
  const zoomChangeRef = useRef(onZoomChange);
  zoomChangeRef.current = onZoomChange;
  const buildRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  unavailableRef.current = onUnavailable;
  zoomRef.current = zoom;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined;
    let frameId = 0;
    let disposed = false;
    const fail = () => {
      if (disposed) return;
      setUnavailable(true);
      setLoading(false);
      unavailableRef.current?.();
    };
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = DAYLIGHT_LEVELS.exposure;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.setClearColor(0, 0);
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-500, 500, 500, -500, 1, 100000);
      camera.position.set(400, 180, 1800);
      camera.zoom = Math.max(0.25, Math.min(4, zoomRef.current / 100));
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.enablePan = false;
      controls.screenSpacePanning = true;
      controls.rotateSpeed = 0.68;
      controls.zoomSpeed = 0.85;
      controls.minZoom = 0.25;
      controls.maxZoom = 4;
      controls.minPolarAngle = 0.08;
      controls.maxPolarAngle = Math.PI - 0.08;
      const environmentScene = new RoomEnvironment();
      const generator = new THREE.PMREMGenerator(renderer);
      const environment = generator.fromScene(environmentScene, .04);
      scene.environment = environment.texture;
      scene.environmentIntensity = DAYLIGHT_LEVELS.environment;
      generator.dispose(); environmentScene.dispose();
      const ambient = new THREE.HemisphereLight("#ffffff", "#5e6971", DAYLIGHT_LEVELS.ambient);
      const key = new THREE.PointLight("#ffffff", 1, 0, 2);
      key.castShadow = true;
      const shadowSize = Math.min(2048, renderer.capabilities.maxCubemapSize);
      key.shadow.mapSize.set(shadowSize, shadowSize);
      // A point shadow has six faces: rebuild only when the source or geometry changes.
      key.shadow.autoUpdate = false;
      key.shadow.bias = -0.00005;
      key.shadow.normalBias = 0.6;
      key.shadow.radius = 1;
      const fill = new THREE.DirectionalLight("#dce9ef", DAYLIGHT_LEVELS.fill);
      scene.add(ambient, key, fill, fill.target);
      host.appendChild(renderer.domElement);
      const currentRenderer = renderer;
      const currentControls = controls;
      const render = () => {
        frameId = 0;
        if (disposed || document.visibilityState === "hidden") return;
        try {
          currentRenderer.render(scene, camera);
          host.dataset.cameraZoom = String(camera.zoom);
          host.dataset.cameraViewHeight = String(camera.top - camera.bottom);
          host.dataset.cameraTarget = currentControls.target.toArray().map(value => value.toFixed(3)).join(",");
          host.dataset.signAnchor = runtime.signAnchor.toArray().map(value => value.toFixed(3)).join(",");
          const signScreen = runtime.signAnchor.clone().project(camera);
          host.dataset.signScreen = `${signScreen.x.toFixed(4)},${signScreen.y.toFixed(4)}`;
          const value = Math.round(camera.zoom * 100);
          if (value !== zoomRef.current) zoomChangeRef.current?.(value);
        } catch { fail(); }
      };
      const requestRender = () => {
        if (!disposed && !frameId) frameId = requestAnimationFrame(render);
      };
      let daylightIntensity = 1;
      const runtime: SceneRuntime = {
        renderer, scene, camera, controls, model: null, ambient, key, fill,
        distance: 1800, requestRender, bounds: new THREE.Box3(),
        fitCenter: new THREE.Vector3(), signAnchor: new THREE.Vector3(),
        focusZoom() {
          const target = runtime.fitCenter.clone().lerp(runtime.signAnchor, zoomFocusWeight(camera.zoom));
          const delta = target.sub(currentControls.target);
          if (delta.lengthSq() < 1e-10) return;
          // Translate both together: focusing must preserve the user's rotation and distance.
          camera.position.add(delta); currentControls.target.add(delta);
          currentControls.update();
        },
        source(marker) {
          if (runtime.bounds.isEmpty()) return;
          const center = runtime.bounds.getCenter(new THREE.Vector3());
          const extent = runtime.bounds.getSize(new THREE.Vector3());
          const span = Math.max(extent.x, extent.y, extent.z, 100);
          const source = daylightSource({ center, span }, marker);
          key.position.set(source.position.x, source.position.y, source.position.z);
          daylightIntensity = source.intensity;
          key.intensity = daylightIntensity * (1 - lightFraction.current);
          const shadow = pointShadowFrustum(runtime.bounds, key.position);
          key.shadow.camera.near = shadow.near; key.shadow.camera.far = shadow.far; key.shadow.bias = shadow.bias;
          key.shadow.camera.updateProjectionMatrix(); key.shadow.needsUpdate = true;
          fill.position.set(center.x + span * .8, center.y + span * .25, center.z + span);
          fill.target.position.copy(center); fill.target.updateMatrixWorld();
          host.dataset.daylightSource = "point";
          host.dataset.daylightMarker = `${marker.x.toFixed(2)},${marker.y.toFixed(2)}`;
          host.dataset.shadowRange = `${shadow.near.toFixed(3)},${shadow.far.toFixed(3)}`;
          host.dataset.shadowBias = shadow.bias.toFixed(8);
          requestRender();
        },
        light(night, windows, lightsOn) {
          ambient.intensity = DAYLIGHT_LEVELS.ambient + (.08 - DAYLIGHT_LEVELS.ambient) * night;
          key.intensity = daylightIntensity * (1 - night);
          fill.intensity = DAYLIGHT_LEVELS.fill + (.025 - DAYLIGHT_LEVELS.fill) * night;
          scene.environmentIntensity = DAYLIGHT_LEVELS.environment + (.07 - DAYLIGHT_LEVELS.environment) * night;
          currentRenderer.toneMappingExposure = DAYLIGHT_LEVELS.exposure;
          if (runtime.model) applySignLighting(runtime.model, night, lightsOn, windows);
          host.dataset.nightFraction = night.toFixed(3);
          host.dataset.windowLightFraction = windows.toFixed(3);
          host.dataset.lightingPhase = night === 0 ? "day" : windows === 1 ? "night" : "dusk";
          requestRender();
        },
        fitToView() {
          if (!runtime.model || runtime.bounds.isEmpty()) return;
          camera.updateMatrixWorld();
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          const center = runtime.fitCenter;
          let halfWidth = 0, halfHeight = 0;
          const box = runtime.bounds;
          for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
            const point = new THREE.Vector3(x, y, z).sub(center);
            halfWidth = Math.max(halfWidth, Math.abs(point.dot(right)));
            halfHeight = Math.max(halfHeight, Math.abs(point.dot(up)));
          }
          const aspect = Math.max(0.2, host.clientWidth / Math.max(1, host.clientHeight));
          const view = layoutRef.current;
          let viewHeight = Math.max(view.viewHeight, view.viewWidth / aspect, halfHeight * 2.15, halfWidth * 2.15 / aspect);
          // Fit billboards too, with a readable pixel size even on a narrow phone.
          for (let pass = 0; pass < 3; pass++) {
            runtime.model.traverse(child => {
              if (!(child instanceof THREE.Sprite)) return;
              const pixelHeight = host.clientWidth < 500 ? 20 : 24;
              const labelHeight = Math.max(child.userData.labelHeight, pixelHeight * viewHeight / Math.max(1, host.clientHeight));
              child.scale.set(labelHeight * child.userData.labelAspect, labelHeight, 1);
              const point = child.getWorldPosition(new THREE.Vector3()).sub(center);
              halfWidth = Math.max(halfWidth, Math.abs(point.dot(right)) + child.scale.x / 2);
              halfHeight = Math.max(halfHeight, Math.abs(point.dot(up)) + child.scale.y / 2);
            });
            viewHeight = Math.max(viewHeight, halfHeight * 2.15, halfWidth * 2.15 / aspect);
          }
          camera.left = -viewHeight * aspect / 2; camera.right = -camera.left;
          camera.top = viewHeight / 2; camera.bottom = -camera.top;
          camera.updateProjectionMatrix();
        },
        frame(front, preserveOrbit = false) {
          if (!runtime.model) return;
          const box = new THREE.Box3();
          for (const child of runtime.model.children) {
            if (child.name === 'panel-construction') {
              for (const part of child.children) if (part.name !== 'dimensions') box.expandByObject(part);
            } else if (child.name !== 'dimensions') box.expandByObject(child);
          }
          if (box.isEmpty()) return;
          const center = panelRef.current || runtime.model.getObjectByName('facade') ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, box.max.z / 2);
          const view = layoutRef.current;
          const aspect = Math.max(0.2, host.clientWidth / Math.max(1, host.clientHeight));
          const viewHeight = Math.max(view.viewHeight, view.viewWidth / aspect);
          camera.left = -viewHeight * aspect / 2;
          camera.right = viewHeight * aspect / 2;
          camera.top = viewHeight / 2;
          camera.bottom = -viewHeight / 2;
          camera.updateProjectionMatrix();
          const sceneSize = box.getSize(new THREE.Vector3());
          runtime.distance = Math.max(view.viewWidth, view.viewHeight, sceneSize.x, sceneSize.y, sceneSize.z) * 3;
          const canopyView = runtime.model.userData.placement === 'canopy';
          const panelPose = runtime.model.userData.panelPose as ReturnType<typeof panelMountLayout> | undefined;
          const panelFront = panelPose ? new THREE.Vector3(Math.sin(panelPose.rotationY), 0, Math.cos(panelPose.rotationY)) : new THREE.Vector3(0, 0, 1);
          const panelDefault = panelPose?.mode === 'corner' ? new THREE.Vector3(.3, .18, 1)
            : panelPose?.mode === 'corner-front' ? new THREE.Vector3(.8, .18, 1)
            : panelPose?.mode === 'corner-side' ? new THREE.Vector3(1, .18, .8)
            : runtime.model.userData.placement === 'none' && panelPose ? new THREE.Vector3(-1, .15, .65) : new THREE.Vector3(.85, .12, 1);
          const direction = preserveOrbit
            ? camera.position.clone().sub(currentControls.target).normalize()
            : front ? panelFront : (panelPose ? panelDefault : runtime.model.userData.contextProducts
              ? new THREE.Vector3(.75, .16, 1) : new THREE.Vector3(panelRef.current ? 0.68 : canopyView ? 0.55 : 0.3, canopyView ? 0.3 : 0.12, 1)).normalize();
          runtime.fitCenter.copy(center);
          const focus = center.clone().lerp(runtime.signAnchor, zoomFocusWeight(camera.zoom));
          currentControls.target.copy(focus);
          camera.position.copy(focus).addScaledVector(direction, runtime.distance);
          currentControls.minDistance = Math.max(100, runtime.distance * 0.22);
          currentControls.maxDistance = runtime.distance * 4;
          currentControls.update();
          runtime.fitToView();
          requestRender();
        },
        resize() {
          if (disposed) return;
          const box = host.getBoundingClientRect();
          const canvasWidth = Math.max(1, Math.round(box.width));
          const canvasHeight = Math.max(1, Math.round(box.height));
          currentRenderer.setSize(canvasWidth, canvasHeight, false);
          camera.updateProjectionMatrix();
          if (runtime.model) runtime.fitToView();
          requestRender();
        },
      };
      runtimeRef.current = runtime;
      const controlsChanged = () => { runtime.focusZoom(); requestRender(); };
      currentControls.addEventListener("change", controlsChanged);
      const contextLost = (event: Event) => { event.preventDefault(); fail(); };
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      const visible = () => { if (document.visibilityState === "visible") requestRender(); };
      document.addEventListener("visibilitychange", visible);
      observer = new ResizeObserver(runtime.resize);
      observer.observe(host);
      runtime.resize();
      return () => {
        disposed = true;
        buildRef.current++;
        cancelAnimationFrame(frameId);
        observer?.disconnect();
        document.removeEventListener("visibilitychange", visible);
        currentRenderer.domElement.removeEventListener("webglcontextlost", contextLost);
        currentControls.removeEventListener("change", controlsChanged);
        currentControls.dispose();
        if (runtime.model) disposeSignObject(runtime.model);
        environment.dispose();
        key.shadow.dispose();
        currentRenderer.renderLists.dispose();
        currentRenderer.dispose();
        currentRenderer.forceContextLoss();
        currentRenderer.domElement.remove();
        runtimeRef.current = null;
      };
    } catch {
      controls?.dispose();
      observer?.disconnect();
      renderer?.dispose();
      renderer?.domElement.remove();
      fail();
    }
    return () => { disposed = true; buildRef.current++; };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || unavailable) return;
    const version = ++buildRef.current;
    if (hostRef.current) delete hostRef.current.dataset.renderedFont;
    setLoading(true);
    // The facade keeps its physical scale; construction labels stay in the screen-pinned size bar.
    void buildSignModel(modelProject, layout, width, height, depth, showDimensions && placement === 'none').then(async(model) => {
      if (modelCompanion && placement !== 'none') {
        try {
          const paired = await buildSignModel(modelCompanion.project, layout, modelCompanion.width, modelCompanion.height, modelCompanion.depth, false);
          const panelProject = project.productId === 'panel' ? project : modelCompanion.project;
          const frontWidth = project.productId === 'panel' ? modelCompanion.width : width;
          const frontHeight = project.productId === 'panel' ? modelCompanion.height : height;
          attachFacadePair(model, paired, project.productId, placement,
            { mode: panelProject.panelMountMode ?? 'wall', size: panelProject.panelSize, depth: project.productId === 'panel' ? depth : modelCompanion.depth,
              gap: panelProject.panelWallGap ?? 120, shape: panelProject.panelShape, cornerRadius: panelProject.panelCornerRadius }, frontWidth, frontHeight, project.facadePalette);
        } catch (error) { disposeSignObject(model); throw error; }
      }
      if(placement==='none'&&project.productId!=='panel'&&project.backdropImage&&/^data:image\/(png|jpeg|webp);base64,/.test(project.backdropImage)) {
        try {
          const texture=await new THREE.TextureLoader().loadAsync(project.backdropImage);
          texture.colorSpace=THREE.SRGBColorSpace;
          const image=texture.image as HTMLImageElement;
          const photoWidth=project.backdropWidth??4000,photoHeight=photoWidth*image.height/image.width;
          const material=new THREE.MeshBasicMaterial({map:texture,color:'#ffffff',side:THREE.DoubleSide,toneMapped:false});
          material.userData.dayColor=new THREE.Color('#ffffff'); material.userData.photoBackdrop=true;
          const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(photoWidth,photoHeight),material);
          backdrop.name='photo-facade'; backdrop.position.set(0,-photoHeight*.1,-Math.max(25,project.acpDepth+4)); model.add(backdrop);
        } catch { /* Keep the sign usable if a saved reference image cannot decode. */ }
      }
      if (version !== buildRef.current || runtime !== runtimeRef.current) {
        disposeSignObject(model); return;
      }
      const preserveOrbit = runtime.model?.userData.productId === project.productId && runtime.model?.userData.placement === placement
        && runtime.model?.userData.panelPose?.mode === (project.productId === 'panel' ? project.panelMountMode ?? 'wall' : undefined);
      model.userData.placement = placement;
      if (runtime.model) {
        runtime.scene.remove(runtime.model);
        disposeSignObject(runtime.model);
      }
      if (!model.getObjectByName('facade') && project.productId === 'panel') {
        const pose = panelMountLayout(project.panelSize, project.panelShape, project.panelWallGap, project.panelCornerRadius, depth, project.panelMountMode ?? 'wall');
        const construction = new THREE.Group(); construction.name = 'panel-construction';
        for (const child of [...model.children]) construction.add(child);
        construction.rotation.y = pose.rotationY;
        construction.position.set(pose.position.x, pose.position.y, pose.position.z);
        model.add(construction); model.userData.panelPose = pose;
        const panelMount = { mode: pose.mode, size: project.panelSize, depth, gap: pose.gap, shape: project.panelShape, cornerRadius: project.panelCornerRadius };
        model.add(placement === 'none' ? createPanelMountContext(panelMount, project.facadePalette)
          : createFacadeModel(placement, width, height, { palette: project.facadePalette, panelMount: pose }));
      } else if (!model.getObjectByName('facade') && placement !== 'none') {
        const signBackMm = Math.max(0, -new THREE.Box3().setFromObject(model).min.z);
        model.add(createFacadeModel(placement, width, height, { palette: project.facadePalette, signBackMm }));
      }
      const facade = model.getObjectByName('facade') as THREE.Group | undefined;
      if (facade) {
        setFacadeProductVisibility(model, visibilityRef.current.showSign, visibilityRef.current.showPanel);
        const brand = await loadScalePersonBrand(import.meta.env.BASE_URL).catch(() => undefined);
        if (version !== buildRef.current || runtime !== runtimeRef.current) { brand?.dispose(); disposeSignObject(model); return; }
        const person = createScalePerson(facade, signFocusBounds(model).getCenter(new THREE.Vector3()), brand);
        if (person) { person.visible = showPersonRef.current; facade.add(person); }
      }
      runtime.model = model;
      if (hostRef.current) {
        hostRef.current.dataset.renderedFont = project.productId === "letters" ? project.letterFont : project.productId === "neon" ? project.neonFont ?? "rounded" : project.productId;
        hostRef.current.dataset.contextProducts = (model.userData.contextProducts ?? [project.productId]).join(',');
        hostRef.current.dataset.visibleProducts = (model.userData.visibleProducts ?? [project.productId]).join(',');
        hostRef.current.dataset.scalePersonHeight = facade?.getObjectByName('scale-person') ? '1750' : '';
      }
      runtime.scene.add(model);
      runtime.bounds.setFromObject(model);
      const focusBounds = signFocusBounds(model);
      if (focusBounds.isEmpty()) runtime.signAnchor.set(0, 0, 0);
      else focusBounds.getCenter(runtime.signAnchor);
      runtime.source(sunMarkerRef.current);
      runtime.light(lightFraction.current, windowFraction.current, lightsOnRef.current);
      runtime.frame(!modelCompanion && project.productId !== "panel" && placement !== 'canopy', preserveOrbit);
      runtime.requestRender();
      setLoading(false);
    }).catch(() => {
      if (version !== buildRef.current) return;
      setLoading(false); setUnavailable(true);
      unavailableRef.current?.();
    });
    return () => { if (version === buildRef.current) buildRef.current++; };
  }, [modelProject, modelCompanion, layout, width, height, depth, showDimensions, placement, unavailable]);

  useEffect(() => {
    const runtime = runtimeRef.current, person = runtime?.model?.getObjectByName('scale-person');
    if (person) { person.visible = showPerson; runtime!.key.shadow.needsUpdate = true; runtime!.requestRender(); }
  }, [showPerson]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.model || placement === 'none') return;
    setFacadeProductVisibility(runtime.model, showSign, showPanel);
    if (hostRef.current) hostRef.current.dataset.visibleProducts = runtime.model.userData.visibleProducts.join(',');
    const focus = signFocusBounds(runtime.model);
    if (!focus.isEmpty()) focus.getCenter(runtime.signAnchor);
    runtime.key.shadow.needsUpdate = true; runtime.focusZoom(); runtime.requestRender();
  }, [showSign, showPanel, placement]);

  useEffect(() => {
    const targetNight = project.sceneMode === "night";
    const from = { night: lightFraction.current, windows: windowFraction.current };
    const start = performance.now();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = sceneLightingDuration(targetNight, reducedMotion);
    let frame = 0;
    const step = (now: number) => {
      const runtime = runtimeRef.current; if (!runtime) return;
      const elapsed = now - start;
      const light = sceneLightingAt(from, targetNight, elapsed, reducedMotion);
      lightFraction.current = light.night;
      windowFraction.current = light.windows;
      runtime.light(light.night, light.windows, lightsOnRef.current);
      if (elapsed < duration) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [project.sceneMode]);

  useEffect(()=>{const runtime=runtimeRef.current;if(runtime?.model){runtime.light(lightFraction.current,windowFraction.current,project.lightsOn!==false);runtime.requestRender();}},[project.lightsOn]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.camera.zoom = Math.max(0.25, Math.min(4, zoom / 100));
    runtime.camera.updateProjectionMatrix();
    runtime.focusZoom();
    runtime.requestRender();
  }, [zoom]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime?.model) runtime.frame(false, true);
  }, [resetKey]);

  useEffect(() => { runtimeRef.current?.source(sunMarker); }, [sunMarker]);
  const placeSun = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
    setSunMarker({ x: Math.max(.06, Math.min(.94, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(.06, Math.min(.94, (event.clientY - bounds.top) / bounds.height)) });
  };
  const sunKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Home") { setSunMarker({ x: .18, y: .2 }); return; }
    const step = event.shiftKey ? .1 : .03;
    setSunMarker(value => ({ x: Math.max(.06, Math.min(.94, value.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))),
      y: Math.max(.06, Math.min(.94, value.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0))) }));
  };

  const changeView = (front: boolean) => runtimeRef.current?.frame(front);
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const key = event.key.toLowerCase();
    if (!["arrowleft", "arrowright", "arrowup", "arrowdown", "+", "=", "-", "f", "r", "home"].includes(key)) return;
    event.preventDefault();
    if (key === "f") { runtime.frame(true); return; }
    if (key === "r" || key === "home") { runtime.frame(false); return; }
    const offset = runtime.camera.position.clone().sub(runtime.controls.target);
    const sphere = new THREE.Spherical().setFromVector3(offset);
    if (key === "arrowleft") sphere.theta -= 0.12;
    if (key === "arrowright") sphere.theta += 0.12;
    if (key === "arrowup") sphere.phi = Math.max(0.08, sphere.phi - 0.12);
    if (key === "arrowdown") sphere.phi = Math.min(Math.PI - 0.08, sphere.phi + 0.12);
    if (key === "+" || key === "=") runtime.camera.zoom = Math.min(4, runtime.camera.zoom / 0.85);
    if (key === "-") runtime.camera.zoom = Math.max(0.25, runtime.camera.zoom * 0.85);
    runtime.camera.updateProjectionMatrix();
    runtime.camera.position.copy(runtime.controls.target).add(new THREE.Vector3().setFromSpherical(sphere));
    runtime.controls.update(); runtime.requestRender();
  };

  return (
    <div className={"sign-scene-3d " + project.sceneMode} onKeyDown={keyboard} tabIndex={0}
      role="group" aria-label="Интерактивная 3D-модель вывески. Стрелки вращают модель, плюс и минус меняют масштаб, F — вид спереди, R — сброс ракурса."
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - F R Home">
      <div className="sign-scene-3d-viewport" ref={hostRef} aria-hidden="true" />
      <button type="button" className="daylight-source" style={{ left: `${sunMarker.x * 100}%`, top: `${sunMarker.y * 100}%` }}
        aria-label="Источник дневного света. Перетащите или используйте стрелки; Home — исходное положение."
        title="Переместите источник света для изменения теней и бликов" disabled={unavailable || project.sceneMode === "night"}
        aria-hidden={project.sceneMode === "night"}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={placeSun} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={sunKeyboard}><Sun size={17} /><span>Свет</span></button>
      <div className="sign-scene-3d-actions">
        <button type="button" onClick={() => changeView(true)} title="Вид спереди (F)" disabled={unavailable}>
          <ScanLine size={15} /><span>Спереди</span>
        </button>
        <button type="button" onClick={() => changeView(false)} title="Сбросить ракурс (R)" disabled={unavailable}>
          <RotateCcw size={15} /><span>Сбросить ракурс</span>
        </button>
      </div>
      {loading && <div className="sign-scene-3d-status" role="status">Готовим объемную модель…</div>}
      {unavailable && <div className="sign-scene-3d-status" role="status">3D сейчас недоступно. Открываем плоский вид.</div>}
      {!loading && !unavailable && <p className="sign-scene-3d-hint">Перетащите для вращения · колесо или два пальца для масштаба</p>}
      <div className="sign-scene-3d-notices" aria-live="polite">
        {placement !== 'none' && showPerson && <span className="scale-person-note">Человек 175 см · дверь 110 × 210 см</span>}
        {project.productId === "letters" && project.mountMode === "frame" && project.letterHeight > 550 &&
          <span>Рама 15 × 15 мм показана в масштабе. Для букв выше 550 мм профиль требует проверки.</span>}
      </div>
    </div>
  );
}

export default SignScene3D;
