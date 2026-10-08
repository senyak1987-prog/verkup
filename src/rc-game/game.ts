import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CarInput } from './physics';
import { createRcWorld, type RcMode, type RcTelemetry } from './world';
export type { RcMode, RcTelemetry } from './world';

export type RcCamera = 'overview' | 'follow' | 'rear' | 'detail';
export interface RcGameOptions {
  onTelemetry?: (telemetry: RcTelemetry) => void;
  onLap?: (seconds: number) => void;
  onError?: (message: string) => void;
}
export interface RcGameController {
  reset(): void; setPaused(paused: boolean): void; setCamera(camera: RcCamera): void;
  setColor(hex: string): void; setMode(mode: RcMode): void; destroy(): void;
}

const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

/** Framework-free renderer. Events, GPU resources and animation belong to this instance only. */
export function mountRcGame(host: HTMLElement, options: RcGameOptions = {}): RcGameController {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  const canvas = renderer.domElement;
  canvas.className = 'rc-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '3D-полигон. Удерживайте левую кнопку мыши и указывайте направление. Стрелки или WASD — управление, пробел — тормоз.');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline-offset:-4px;';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#edf2ee');
  const camera = new THREE.PerspectiveCamera(36, 1, .1, 150);
  const world = createRcWorld({ onLap: options.onLap });
  const physics = world.physics;
  scene.add(world.group);
  const abort = new AbortController();
  const signal = abort.signal;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .4;
  room.dispose();
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight('#ffffff', '#778b79', .9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff5df', 2.5);
  sun.position.set(-8, 17, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -15;
  sun.shadow.camera.right = sun.shadow.camera.top = 15;
  sun.shadow.normalBias = .025;
  sun.shadow.bias = -.00015;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#f1f6ff', .7);
  fill.position.set(8, 7, -12);
  scene.add(fill);

  let cameraMode:RcCamera='overview',paused=false,visible=true,destroyed=false,contextLost=false;
  let pointerId:number|null=null,pressed=false,braking=false;
  const pointer=new THREE.Vector2();let hasPointer=false;
  const keys=new Set<string>();
  const raycaster=new THREE.Raycaster();const plane=new THREE.Plane(UP,0);const intersection=new THREE.Vector3();
  const cameraTarget=new THREE.Vector3();const desiredCamera=new THREE.Vector3();const lookAt=new THREE.Vector3();
  let lastTime=0,telemetryClock=0,frame=0;

  function telemetry() {
    options.onTelemetry?.(world.getTelemetry(paused,pressed||keys.has('w')||keys.has('arrowup')));
  }
  function clearInput() {
    pressed=braking=false;keys.clear();hasPointer=false;
    if(pointerId!==null&&canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId);
    pointerId=null;
  }
  function pointerPosition(event:PointerEvent) {
    const rect=canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);hasPointer=true;
  }
  canvas.addEventListener('pointerdown',event=>{
    if(pointerId!==null && pointerId!==event.pointerId)return;
    if(paused||contextLost)return;
    event.preventDefault();canvas.focus({preventScroll:true});pointerPosition(event);
    pointerId=event.pointerId;canvas.setPointerCapture(event.pointerId);
    if(event.button===2)braking=true;else if(event.button===0)pressed=true;
  },{signal});
  canvas.addEventListener('pointermove',event=>{
    if(pointerId!==null&&pointerId!==event.pointerId)return;pointerPosition(event);
    if(event.pointerType==='mouse'&&pointerId!==null){pressed=!!(event.buttons&1);braking=!!(event.buttons&2);}
  },{signal});
  canvas.addEventListener('mousedown',event=>{if(!paused){pressed=!!(event.buttons&1);braking=!!(event.buttons&2);}},{signal});
  canvas.addEventListener('mouseup',event=>{pressed=!!(event.buttons&1);braking=!!(event.buttons&2);},{signal});
  canvas.addEventListener('pointerup',event=>{if(event.pointerId===pointerId)clearInput();},{signal});
  canvas.addEventListener('pointercancel',clearInput,{signal});
  canvas.addEventListener('lostpointercapture',()=>{pressed=braking=false;pointerId=null;},{signal});
  canvas.addEventListener('contextmenu',event=>event.preventDefault(),{signal});
  canvas.addEventListener('blur',clearInput,{signal});
  canvas.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();
    if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' ','shift'].includes(key)) {event.preventDefault();keys.add(key);}
  },{signal});
  canvas.addEventListener('keyup',event=>{keys.delete(event.key.toLowerCase());},{signal});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;clearInput();options.onError?.('3D-сцена потеряла соединение с видеокартой. Перезапустите игру.');},{signal});
  document.addEventListener('visibilitychange',()=>{clearInput();lastTime=0;schedule();},{signal});
  const observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??true;if(!visible)clearInput();lastTime=0;schedule();},{threshold:0});
  observer.observe(host);

  function resize() {
    if(destroyed)return;
    const rect=host.getBoundingClientRect();const w=Math.max(1,rect.width),h=Math.max(1,rect.height);
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();lastTime=0;schedule();
  }
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);
  function updateCamera(dt:number,instant=false) {
    const state=physics.state;
    if(cameraMode==='overview') {
      const scale=Math.max(.98,1.08/camera.aspect);
      desiredCamera.set(14*scale,17*scale,20*scale);cameraTarget.set(0,0,0);
    } else if(cameraMode==='follow') {
      desiredCamera.set(state.x-Math.sin(state.yaw)*5.3,5.3,state.z-Math.cos(state.yaw)*5.3);
      cameraTarget.set(state.x,state.y+.1,state.z);
    } else if(cameraMode==='rear') {
      const distance=Math.max(4.6,3.8/camera.aspect);
      desiredCamera.set(state.x-Math.sin(state.yaw)*distance,state.y+1.55,state.z-Math.cos(state.yaw)*distance);
      cameraTarget.set(state.x+Math.sin(state.yaw)*1.25,state.y+.65,state.z+Math.cos(state.yaw)*1.25);
    } else {
      const scale=Math.max(1,.8/camera.aspect);
      desiredCamera.set(state.x+2.5*scale,state.y+1.7*scale,state.z+3.4*scale);
      cameraTarget.set(state.x,state.y+.65,state.z);
    }
    const a=instant?1:1-Math.exp(-dt*(cameraMode==='follow'||cameraMode==='rear'?5:7));
    camera.position.lerp(desiredCamera,a);lookAt.lerp(cameraTarget,a);camera.lookAt(lookAt);
  }
  function input():CarInput {
    let target=null;
    if(hasPointer){raycaster.setFromCamera(pointer,camera);if(raycaster.ray.intersectPlane(plane,intersection))target={x:clamp(intersection.x,-10.3,10.3),z:clamp(intersection.z,-10.3,10.3)};}
    const keyboardDrive=keys.has('w')||keys.has('arrowup')||keys.has('s')||keys.has('arrowdown');
    const reverse=keys.has('shift')||keys.has('s')||keys.has('arrowdown');
    const keyboardSteer=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0);
    return {target:keyboardDrive?null:target,throttle:pressed||keyboardDrive?1:0,brake:braking||keys.has(' '),reverse,steer:keyboardDrive?keyboardSteer:undefined};
  }
  function schedule() {if(!frame&&!destroyed&&!contextLost&&visible&&!document.hidden)frame=requestAnimationFrame(tick);}
  function tick(now:number) {
    frame=0;if(destroyed||contextLost||!visible||document.hidden){lastTime=0;return;}
    const dt=lastTime?Math.min((now-lastTime)/1000,.05):1/60;lastTime=now;
    const control=input();
    if(!paused)world.step(dt,control);
    world.update(control,paused?0:dt,hasPointer&&!paused);updateCamera(dt);renderer.render(scene,camera);
    telemetryClock+=dt;if(telemetryClock>.10){telemetryClock=0;telemetry();}
    if(!paused)schedule();
  }
  function reset() {
    world.reset();clearInput();lastTime=0;
    world.update(input(),0,false);updateCamera(1,true);telemetry();schedule();
  }
  const controller:RcGameController={
    reset,
    setPaused(value){paused=value;clearInput();lastTime=0;telemetry();schedule();},
    setCamera(value){cameraMode=value;clearInput();if(paused)updateCamera(1,true);schedule();},
    setColor(hex){world.setColor(hex);schedule();},
    setMode(value){world.setMode(value);clearInput();lastTime=0;world.update(input(),0,false);updateCamera(1,true);telemetry();schedule();},
    destroy(){
      if(destroyed)return;destroyed=true;cancelAnimationFrame(frame);abort.abort();resizeObserver.disconnect();observer.disconnect();clearInput();
      world.dispose();environment.dispose();
      renderer.dispose();renderer.forceContextLoss();canvas.remove();
    },
  };
  resize();world.update(input(),0,false);updateCamera(1,true);telemetry();schedule();
  return controller;
}
