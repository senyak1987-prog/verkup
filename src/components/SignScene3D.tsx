import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { RotateCcw, ScanLine } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildSignModel, disposeSignObject } from "../lib/signSceneGeometry";
import type { SignSceneLayout, SignSceneProject } from "../lib/signSceneGeometry";
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
  resetKey?: number;
  onUnavailable?: () => void;
};

type SceneRuntime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  model: THREE.Group | null;
  wall: THREE.Mesh;
  ambient: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  distance: number;
  requestRender: () => void;
  frame: (front: boolean, preserveOrbit?: boolean) => void;
  resize: () => void;
};

export function SignScene3D({ project, layout, width, height, depth, showDimensions, zoom, resetKey = 0, onUnavailable }: SignScene3DProps) {
  const layoutRef = useRef(layout);
  layoutRef.current = project.productId === "panel"
    ? { ...layout, viewWidth: project.panelSize * 1.8, viewHeight: project.panelSize * 1.42 }
    : layout;
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const unavailableRef = useRef(onUnavailable);
  const zoomRef = useRef(zoom);
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
      camera.zoom = Math.max(0.5, Math.min(2, zoomRef.current / 100));
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      controls.rotateSpeed = 0.68;
      controls.zoomSpeed = 0.85;
      controls.minZoom = 0.35;
      controls.maxZoom = 5;
      controls.minPolarAngle = 0.08;
      controls.maxPolarAngle = Math.PI - 0.08;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshStandardMaterial({ color: "#e9eae5", roughness: 0.94, metalness: 0, side: THREE.FrontSide }));
      wall.position.z = -110;
      wall.receiveShadow = true;
      scene.add(wall);
      const ambient = new THREE.HemisphereLight("#ffffff", "#5e6971", 2);
      const key = new THREE.DirectionalLight("#fff5e9", 3.2);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.bias = -0.00015;
      key.shadow.normalBias = 0.3;
      key.shadow.radius = 3;
      const fill = new THREE.DirectionalLight("#dce9ef", 1.2);
      scene.add(ambient, key, key.target, fill, fill.target);
      host.appendChild(renderer.domElement);
      const currentRenderer = renderer;
      const currentControls = controls;
      const render = () => {
        frameId = 0;
        if (disposed || document.visibilityState === "hidden") return;
        try { currentRenderer.render(scene, camera); } catch { fail(); }
      };
      const requestRender = () => {
        if (!disposed && !frameId) frameId = requestAnimationFrame(render);
      };
      const runtime: SceneRuntime = {
        renderer, scene, camera, controls, model: null, wall, ambient, key, fill,
        distance: 1800, requestRender,
        frame(front, preserveOrbit = false) {
          if (!runtime.model) return;
          const box = new THREE.Box3();
          for (const child of runtime.model.children) if (child.name !== "dimensions") box.expandByObject(child);
          if (box.isEmpty()) return;
          const center = new THREE.Vector3(0, 0, box.max.z / 2);
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
            : front ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0.3, 0.12, 1).normalize();
          currentControls.target.copy(center);
          camera.position.copy(center).addScaledVector(direction, runtime.distance);
          currentControls.minDistance = Math.max(100, runtime.distance * 0.22);
          currentControls.maxDistance = runtime.distance * 4;
          currentControls.update();
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
        disposeSignObject(wall);
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
    setLoading(true);
    void buildSignModel(project, layout, width, height, depth, showDimensions).then((model) => {
      if (version !== buildRef.current || runtime !== runtimeRef.current) {
        disposeSignObject(model); return;
      }
      const preserveOrbit = runtime.model !== null;
      if (runtime.model) {
        runtime.scene.remove(runtime.model);
        disposeSignObject(runtime.model);
      }
      runtime.model = model;
      runtime.scene.add(model);
      const night = project.sceneMode === "night";
      (runtime.wall.material as THREE.MeshStandardMaterial).color.set(night ? "#596773" : "#e9eae5");
      if (project.productId === "panel") {
        runtime.wall.rotation.y = Math.PI / 2;
        runtime.wall.scale.set(project.panelSize * 3, project.panelSize * 5, 1);
        runtime.wall.position.set(-project.panelSize * 0.825, 0, depth / 2);
      } else {
        runtime.wall.rotation.y = 0;
        runtime.wall.scale.set(Math.max(width * 4, height * 5), Math.max(height * 5, width * 1.5), 1);
        runtime.wall.position.set(0, 0, project.mountMode === "acp" ? -project.acpDepth - 2 : -2);
      }
      runtime.ambient.intensity = night ? 0.65 : 2;
      runtime.key.intensity = night ? 0.65 : 3.2;
      runtime.fill.intensity = night ? 0.35 : 1.2;
      runtime.renderer.toneMappingExposure = night ? 0.9 : 1.1;
      runtime.key.position.set(-width * 0.35, height * 2.4, Math.max(width, height) * 1.5);
      runtime.fill.position.set(width * 0.8, height * 0.3, Math.max(width, height));
      const shadow = runtime.key.shadow.camera;
      shadow.left = -width; shadow.right = width;
      shadow.top = height * 2; shadow.bottom = -height * 2;
      shadow.near = 1; shadow.far = Math.max(width, height) * 6 + 1000;
      shadow.updateProjectionMatrix();
      runtime.frame(true, preserveOrbit);
      runtime.requestRender();
      setLoading(false);
    }).catch(() => {
      if (version !== buildRef.current) return;
      setLoading(false); setUnavailable(true);
      unavailableRef.current?.();
    });
    return () => { if (version === buildRef.current) buildRef.current++; };
  }, [project, layout, width, height, depth, showDimensions, unavailable]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.camera.zoom = Math.max(0.5, Math.min(2, zoom / 100));
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
    if (key === "+" || key === "=") runtime.camera.zoom = Math.min(5, runtime.camera.zoom / 0.85);
    if (key === "-") runtime.camera.zoom = Math.max(0.35, runtime.camera.zoom * 0.85);
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
