import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { RotateCcw, ScanLine } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { applySignLighting, buildSignModel, disposeSignObject } from "../lib/signSceneGeometry";
import type { SignSceneLayout, SignSceneProject } from "../lib/signSceneGeometry";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createFacadeModel } from "../lib/signFacade3D";
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
  onZoomChange?: (value: number) => void;
  resetKey?: number;
  onUnavailable?: () => void;
};

type SceneRuntime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  model: THREE.Group | null;
  ambient: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  distance: number;
  requestRender: () => void;
  frame: (front: boolean, preserveOrbit?: boolean) => void;
  resize: () => void;
  fitToView: () => void;
  bounds: THREE.Box3;
};

export function SignScene3D({ project, layout, width, height, depth, showDimensions, zoom, placement = 'none', onZoomChange, resetKey = 0, onUnavailable }: SignScene3DProps) {
  const geometryKey = JSON.stringify({ ...project, sceneMode: undefined, lightsOn:undefined });
  const modelProject = useMemo(() => ({ ...project, sceneMode: 'night' as const, lightsOn:true }), [geometryKey]);
  const lightsOnRef=useRef(project.lightsOn!==false);
  lightsOnRef.current=project.lightsOn!==false;
  const lightFraction = useRef(project.sceneMode === 'night' ? 1 : 0);
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
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
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
      scene.environmentIntensity = .18;
      generator.dispose(); environmentScene.dispose();
      const ambient = new THREE.HemisphereLight("#ffffff", "#5e6971", .65);
      const key = new THREE.DirectionalLight("#fff5e9", 1.1);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.bias = -0.00015;
      key.shadow.normalBias = 0.3;
      key.shadow.radius = 3;
      const fill = new THREE.DirectionalLight("#dce9ef", .3);
      scene.add(ambient, key, key.target, fill, fill.target);
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
          const value = Math.round(camera.zoom * 100);
          if (value !== zoomRef.current) zoomChangeRef.current?.(value);
        } catch { fail(); }
      };
      const requestRender = () => {
        if (!disposed && !frameId) frameId = requestAnimationFrame(render);
      };
      const runtime: SceneRuntime = {
        renderer, scene, camera, controls, model: null, ambient, key, fill,
        distance: 1800, requestRender, bounds: new THREE.Box3(),
        fitToView() {
          if (!runtime.model || runtime.bounds.isEmpty()) return;
          camera.updateMatrixWorld();
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          const center = currentControls.target;
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
          for (const child of runtime.model.children) if (child.name !== "dimensions") box.expandByObject(child);
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
          runtime.distance = Math.max(view.viewWidth, view.viewHeight) * 3;
          const direction = preserveOrbit
            ? camera.position.clone().sub(currentControls.target).normalize()
            : front ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(panelRef.current ? 0.68 : 0.3, 0.12, 1).normalize();
          currentControls.target.copy(center);
          camera.position.copy(center).addScaledVector(direction, runtime.distance);
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
          if (runtime.model) runtime.frame(false, true);
          requestRender();
        },
      };
      runtimeRef.current = runtime;
      currentControls.addEventListener("change", requestRender);
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
        currentControls.removeEventListener("change", requestRender);
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
    void buildSignModel(modelProject, layout, width, height, depth, showDimensions).then(async(model) => {
      if(placement==='none'&&project.backdropImage&&/^data:image\/(png|jpeg|webp);base64,/.test(project.backdropImage)) {
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
      const preserveOrbit = runtime.model?.userData.productId === project.productId;
      if (runtime.model) {
        runtime.scene.remove(runtime.model);
        disposeSignObject(runtime.model);
      }
      runtime.model = model;
      if (placement !== 'none') model.add(createFacadeModel(placement, width, height,{palette:project.facadePalette,signBackMm:project.productId==='neon'?(project.neonInstallMode==='hanging'?0:20):project.mountMode==='acp'?project.acpDepth:15}));
      if (hostRef.current) { hostRef.current.dataset.renderedFont = project.productId === "letters" ? project.letterFont : project.productId === "neon" ? project.neonFont ?? "rounded" : project.productId; }
      runtime.scene.add(model);
      runtime.bounds.setFromObject(model);
      applySignLighting(model, lightFraction.current, lightsOnRef.current);
      runtime.ambient.intensity = .65 - lightFraction.current * .5;
      runtime.key.intensity = 1.1 - lightFraction.current * .95;
      runtime.fill.intensity = .3 - lightFraction.current * .22;
      const extent=runtime.bounds.getSize(new THREE.Vector3()), center=runtime.bounds.getCenter(new THREE.Vector3());
      const lightSpan=Math.max(extent.x,extent.y,width,height);
      runtime.key.position.set(center.x-lightSpan*.55,center.y+lightSpan*.9,center.z+lightSpan*1.4);
      runtime.fill.position.set(center.x+lightSpan*.8,center.y+lightSpan*.25,center.z+lightSpan);
      runtime.key.target.position.copy(center); runtime.key.target.updateMatrixWorld();
      const shadow = runtime.key.shadow.camera;
      shadow.left = -lightSpan*.8; shadow.right = lightSpan*.8;
      shadow.top = lightSpan*.8; shadow.bottom = -lightSpan*.8;
      shadow.near = 1; shadow.far = lightSpan * 6 + 1000;
      shadow.updateProjectionMatrix();
      runtime.frame(project.productId !== "panel", preserveOrbit);
      runtime.requestRender();
      setLoading(false);
    }).catch(() => {
      if (version !== buildRef.current) return;
      setLoading(false); setUnavailable(true);
      unavailableRef.current?.();
    });
    return () => { if (version === buildRef.current) buildRef.current++; };
  }, [modelProject, layout, width, height, depth, showDimensions, placement, unavailable]);

  useEffect(() => {
    const target = project.sceneMode === 'night' ? 1 : 0;
    const from = lightFraction.current, start = performance.now();
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 750;
    let frame = 0;
    const step = (now: number) => {
      const runtime = runtimeRef.current; if (!runtime) return;
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      const eased = t * t * (3 - 2 * t);
      lightFraction.current = from + (target - from) * eased;
      const amount = lightFraction.current;
      runtime.ambient.intensity = .65 - amount * .5;
      runtime.key.intensity = 1.1 - amount * .95;
      runtime.fill.intensity = .3 - amount * .22;
      runtime.renderer.toneMappingExposure = 1.1 - amount * .2;
      if (runtime.model) applySignLighting(runtime.model, amount, lightsOnRef.current);
      runtime.requestRender();
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [project.sceneMode]);

  useEffect(()=>{const runtime=runtimeRef.current;if(runtime?.model){applySignLighting(runtime.model,lightFraction.current,project.lightsOn!==false);runtime.requestRender();}},[project.lightsOn]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.camera.zoom = Math.max(0.25, Math.min(4, zoom / 100));
    runtime.camera.updateProjectionMatrix();
    runtime.requestRender();
  }, [zoom]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime?.model) runtime.frame(false, true);
  }, [resetKey]);

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
      <div className="sign-scene-3d-actions">
        <button type="button" onClick={() => changeView(true)} title="Вид спереди (F)" disabled={unavailable}>
          <ScanLine size={15} /><span>Спереди</span>
        </button>
        <button type="button" onClick={() => changeView(false)} title="Сбросить ракурс (R)" disabled={unavailable}>
          <RotateCcw size={15} /><span>Сбросить</span>
        </button>
      </div>
      {loading && <div className="sign-scene-3d-status" role="status">Готовим объемную модель…</div>}
      {unavailable && <div className="sign-scene-3d-status" role="status">3D сейчас недоступно. Открываем плоский вид.</div>}
      {!loading && !unavailable && <p className="sign-scene-3d-hint">Перетащите для вращения · колесо или два пальца для масштаба</p>}
      <div className="sign-scene-3d-notices" aria-live="polite">
        {project.productId === "letters" && project.mountMode === "frame" && project.letterHeight > 550 &&
          <span>Рама 15 × 15 мм показана в масштабе. Для букв выше 550 мм профиль требует проверки.</span>}
      </div>
    </div>
  );
}

export default SignScene3D;
