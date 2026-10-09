import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RcPhysics, WHEEL_RADIUS, SUSPENSION_REBOUND_TRAVEL, SUSPENSION_COMPRESSION_TRAVEL, type CarInput } from './physics';
import { createDefaultRcSurface, type RcSurface } from './terrainSurface';
import { RcPropsPhysics } from './propsPhysics';
import { createTrxTruck, createTrxWheel } from './trxTruck';
import { createTrxSuspension } from './trxSuspension';
import type { RcVehicleProfile, RcVehicleRig } from './vehicleTypes';
import { sandMaterial, addPaving } from './arenaGround';
import { createVehicleEffects } from './vehicleEffects';

export type RcMode = 'free' | 'trial';
export interface RcTelemetry {
  speed: number; elapsed: number; checkpoint: number; checkpoints: number;
  lap: number; paused: boolean; driving: boolean; suspension: number[]; best: number | null;
}
export interface RcWorldOptions {
  onLap?: (seconds: number) => void;
  surface?: RcSurface;
  vehicleProfile?: RcVehicleProfile;
  loadVehicle?: () => Promise<RcVehicleRig>;
  onVehicleReady?: () => void;
  onVehicleError?: (error: unknown) => void;
}
export interface RcWorld {
  /** Arena and vehicle in arena-local metres; apply placement and scale to this group. */
  group: THREE.Group;
  physics: RcPhysics;
  props: RcPropsPhysics;
  surface: RcSurface;
  step(dt: number, input: CarInput): void;
  update(input: CarInput, dt: number, showTarget?: boolean): void;
  reset(): void;
  setMode(mode: RcMode): void;
  setColor(hex: string): void;
  setLighting(night: number): void;
  getTelemetry(paused?: boolean, driving?: boolean): RcTelemetry;
  dispose(): void;
}

const BEST_KEY = 'gorod-svet.rc-game.best.v1';
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const NEUTRAL_INPUT: CarInput = { target: null, throttle: 0, brake: false, reverse: false };

/** A replacement can share placeholder materials with the arena and suspension. */
function disposeObjects(roots: THREE.Object3D[], retained: THREE.Object3D[] = []) {
  const resources = (objects: THREE.Object3D[]) => {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    objects.forEach(root => root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    }));
    return { geometries, materials, textures };
  };
  const removed = resources(roots), live = resources(retained);
  removed.geometries.forEach(value => { if (!live.geometries.has(value)) value.dispose(); });
  removed.materials.forEach(value => { if (!live.materials.has(value)) value.dispose(); });
  removed.textures.forEach(value => { if (!live.textures.has(value)) value.dispose(); });
}

/** Shared RC arena without a renderer, camera, events, lights or animation loop. */
export function createRcWorld(options: RcWorldOptions = {}): RcWorld {
  const requestedSurface = options.surface ?? createDefaultRcSurface();
  const tireRadius = options.vehicleProfile?.wheelRadius ?? WHEEL_RADIUS, tireWidth = tireRadius * .557;
  const surface = { ...requestedSurface, props: requestedSurface.props.map(spec => {
    if (spec.kind !== 'tire') return spec;
    const parts=spec.id.split('-'), level = Number(parts[parts.length-1]) || 0;
    return { ...spec, radius: tireRadius, height: tireWidth,
      y: requestedSurface.height(spec.x, spec.z) + tireWidth / 2 + level * (tireWidth + .005) };
  }) };
  const terrainHeight = surface.height;
  const CHECKPOINTS = surface.checkpoints;
  const group = new THREE.Group();
  group.name = 'rc-playground';
  group.userData.kind = 'rc-playground';
  group.userData.arenaSize = Math.max(surface.width, surface.depth);
  group.userData.arenaWidth = surface.width;
  group.userData.arenaDepth = surface.depth;
  group.userData.forward = '+Z';
  const physics = new RcPhysics(terrainHeight, { bounds: surface.bounds, spawn: surface.spawn, vehicle: options.vehicleProfile,
    traction: (x, z) => surface.groundKind?.(x, z) === 'pavers' ? 1.35 : 1.1 });
  const requestedModelScale = options.vehicleProfile?.modelScale ?? 1;
  const modelScale = Number.isFinite(requestedModelScale) && requestedModelScale > 0 ? requestedModelScale : 1;
  const props = new RcPropsPhysics(surface.props, { height: terrainHeight, bounds: surface.bounds, barriers: surface.barriers,
    vehicleDimensions: options.vehicleProfile });
  const materials = {
    body: new THREE.MeshPhysicalMaterial({ color: '#e8bc45', roughness: .27, metalness: .5,
      clearcoat: .85, clearcoatRoughness: .16 }),
    dark: new THREE.MeshStandardMaterial({ color: '#173e31', roughness: .48 }),
    tire: new THREE.MeshStandardMaterial({ color: '#222827', roughness: .95 }),
    silver: new THREE.MeshStandardMaterial({ color: '#bcc6c1', metalness: .85, roughness: .3 }),
    white: new THREE.MeshStandardMaterial({ color: '#fafbf5', roughness: .48 }),
    window: new THREE.MeshStandardMaterial({ color: '#101e23', metalness: .3, roughness: .15 }),
    red: new THREE.MeshStandardMaterial({ color: '#e77750', roughness: .5 }),
    spring: new THREE.MeshStandardMaterial({ color: '#ffcc32', metalness: .45, roughness: .3 }),
  };
  const addMesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x=0, y=0, z=0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x,y,z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const box = (parent: THREE.Object3D, w:number,h:number,d:number, material:THREE.Material,x=0,y=0,z=0,r=.035) =>
    addMesh(parent, new RoundedBoxGeometry(w,h,d,3,r),material,x,y,z);

  // Facade ground stops at the real pavement; its existing staircase stays visible.
  const regions = surface.floorRegions ?? [{ minX: -surface.width / 2, maxX: surface.width / 2,
    minZ: -surface.depth / 2, maxZ: surface.depth / 2 }];
  const groundGeometries: THREE.BufferGeometry[] = [];
  for (const region of regions) {
    const width = region.maxX - region.minX, depth = region.maxZ - region.minZ;
    const cx = (region.minX + region.maxX) / 2, cz = (region.minZ + region.maxZ) / 2;
    const table = box(group,width,.36,depth,new THREE.MeshStandardMaterial({color:'#9c8866',roughness:.95}),cx,-.24,cz,.15);
    table.name = 'rc-courtyard'; table.receiveShadow = true;
    const geometry = new THREE.PlaneGeometry(width,depth,Math.ceil(width * 7),Math.ceil(depth * 7));
    geometry.rotateX(-Math.PI/2); geometry.translate(cx,0,cz);
    const positions = geometry.attributes.position;
    for(let i=0;i<positions.count;i++) {
      const x=positions.getX(i),z=positions.getZ(i);
      positions.setY(i,surface.groundKind?.(x,z)==='pavers' ? .001 : terrainHeight(x,z));
    }
    geometry.computeVertexNormals(); groundGeometries.push(geometry);
    const ground = addMesh(group,geometry,sandMaterial(width,depth));
    ground.name = 'rc-driveable-ground'; ground.castShadow = false;
    const curbSize = .06;
    for (const side of [-1,1]) {
      box(group,curbSize,curbSize,depth,materials.white,
        side < 0 ? region.minX : region.maxX,curbSize / 2,cz,.015);
    }
    box(group,width,curbSize,curbSize,materials.white,cx,curbSize / 2,region.maxZ,.015);
    if (!surface.floorRegions) box(group,width,curbSize,curbSize,materials.white,cx,curbSize / 2,region.minZ,.015);
  }
  addPaving(group, surface);
  // Printed lanes are a canvas texture, not thousands of group meshes.
  const decalCanvas=document.createElement('canvas'); decalCanvas.width=decalCanvas.height=1024;
  const ctx=decalCanvas.getContext('2d')!;
  ctx.clearRect(0,0,1024,1024);
  ctx.strokeStyle='#799b8640'; ctx.lineWidth=5; ctx.setLineDash([10,12]);
  ctx.beginPath(); ctx.roundRect(205,215,610,575,165); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='#426c5260'; ctx.textAlign='center'; ctx.font='bold 28px sans-serif';
  ctx.fillText('ГОРОД СВЕТ',512,485); ctx.font='15px sans-serif'; ctx.fillText('RC / PLAYGROUND',512,515);
  // Surface cues make the actual raised sections easy to find from above.
  ctx.fillStyle='#63866b35';
  for(let i=0;i<5;i++)ctx.fillRect(698,414+i*13,68,4);
  for(let i=0;i<7;i++)ctx.fillRect(434+i*14,281,5,34);
  // Starting line and workshop alignment marks are on the ground material itself.
  for(let x=0;x<2;x++) for(let z=0;z<8;z++) {
    ctx.fillStyle=(x+z)%2 ? '#ffffffb0':'#668372a0';
    ctx.fillRect(503+x*8,638+z*8,8,8);
  }
  const decalTexture=new THREE.CanvasTexture(decalCanvas);
  decalTexture.colorSpace=THREE.SRGBColorSpace;
  const decalMat=new THREE.MeshBasicMaterial({map:decalTexture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
  for (const geometry of groundGeometries) {
    const decal = addMesh(group,geometry.clone(),decalMat,0,.003,0); decal.castShadow=decal.receiveShadow=false;
  }

  const checkpointGroups:THREE.Group[]=[];
  const checkpointRings:THREE.Mesh[]=[];
  const checkpointMats:THREE.MeshStandardMaterial[]=[];
  const markerLabels:THREE.Sprite[]=[];
  function label(text:string,color:string) {
    const c=document.createElement('canvas');c.width=c.height=128;
    const cctx=c.getContext('2d')!;
    cctx.fillStyle=color;cctx.beginPath();cctx.arc(64,64,49,0,Math.PI*2);cctx.fill();
    cctx.fillStyle='#fff';cctx.font='bold 58px sans-serif';cctx.textAlign='center';cctx.textBaseline='middle';cctx.fillText(text,64,66);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:true}));sprite.scale.set(.6,.6,.6);return sprite;
  }
  CHECKPOINTS.forEach((point,index)=>{
    const gate=new THREE.Group();gate.name=`rc-checkpoint-${index+1}`;gate.userData.checkpoint=index;
    gate.position.set(point.x,terrainHeight(point.x,point.z),point.z);group.add(gate);
    const next=CHECKPOINTS[(index+1)%CHECKPOINTS.length];
    gate.rotation.y=Math.atan2(next.x-point.x,next.z-point.z);
    const mat=new THREE.MeshStandardMaterial({color:'#a5b9a8',roughness:.5});checkpointMats.push(mat);
    const ring=addMesh(gate,new THREE.RingGeometry(.55,.64,48),new THREE.MeshBasicMaterial({color:'#16803d',transparent:true,opacity:.5,side:THREE.DoubleSide}),0,.016,0);
    ring.name = 'rc-checkpoint-ring'; checkpointRings.push(ring);
    ring.rotation.x=-Math.PI/2;
    const sprite=label(String(index+1),'#497257');sprite.position.set(-1.1,1.25,0);gate.add(sprite);markerLabels.push(sprite);
    checkpointGroups.push(gate);
  });
  const propMeshes: THREE.Group[] = [];
  for (const { spec } of props.bodies) {
    const object = new THREE.Group(); object.name = 'rc-prop-' + spec.id;
    object.userData.kind = spec.kind; object.userData.physical = true; group.add(object); propMeshes.push(object);
    const { radius, height } = spec;
    if (spec.kind === 'cone') {
      box(object,radius*2,.055,radius*2,materials.red,0,-height/2+.0275,0,.018);
      addMesh(object,new THREE.CylinderGeometry(.025,radius*.82,height-.055,20),materials.red,0,.0275,0);
      addMesh(object,new THREE.CylinderGeometry(.077,.115,.12,20),materials.white,0,.115,0);
    } else if (spec.kind === 'tire') {
      const rubber = addMesh(object,new THREE.TorusGeometry(radius-height/2,height/2,12,36),materials.tire);
      rubber.rotation.x=Math.PI/2;
      for (const side of [-1,1]) {
        const bead=addMesh(object,new THREE.TorusGeometry(radius*.64,.018,6,32),materials.dark,0,side*height*.43,0);
        bead.rotation.x=Math.PI/2;
      }
      for(let i=0;i<18;i++) {
        const a=i*Math.PI/9;
        const tread=box(object,.06,height*.78,.09,materials.tire,Math.cos(a)*(radius-.018),0,Math.sin(a)*(radius-.018),.008);
        tread.rotation.y=-a;
      }
    } else if (spec.kind === 'crate') {
      const wood = new THREE.MeshStandardMaterial({ color: '#b28a53', roughness: .88 });
      box(object,radius*2,height,radius*2,wood,0,0,0,.018);
      for (const side of [-1,1]) for (const end of [-1,1])
        box(object,.06,height+.012,.06,materials.dark,side*(radius-.04),0,end*(radius-.04),.005);
      for (const y of [-1,1]) box(object,radius*2+.015,.06,radius*2+.015,materials.dark,0,y*height*.34,0,.006);
    } else if (spec.kind === 'barrel') {
      const barrelMat = new THREE.MeshStandardMaterial({ color: spec.id.includes('-1-') ? '#367165' : '#c57b41', roughness: .6, metalness: .28 });
      addMesh(object,new THREE.CylinderGeometry(radius*.96,radius*.96,height,24),barrelMat);
      for (const y of [-.42,0,.42]) {
        const rim = addMesh(object,new THREE.TorusGeometry(radius,.018,6,24),materials.silver,0,y*height,0); rim.rotation.x=Math.PI/2;
      }
    } else if (spec.kind === 'ball') {
      const ball = new THREE.MeshStandardMaterial({ color: ['#e3af36','#d76344','#68a8b6','#62a273'][Number(spec.id.split('-')[1])%4], roughness: .4 });
      addMesh(object,new THREE.SphereGeometry(radius,24,16),ball);
      const seam=addMesh(object,new THREE.TorusGeometry(radius*.997,.009,6,32),materials.white); seam.rotation.x=Math.PI/2;
    } else {
      const index=Number(spec.id.split('-')[1]);
      const mat=checkpointMats[index] ?? materials.dark;
      addMesh(object,new THREE.CylinderGeometry(radius,radius,.08,16),materials.white,0,-height/2+.04,0);
      addMesh(object,new THREE.CylinderGeometry(.065,.075,height-.14,16),mat,0,0,0);
      addMesh(object,new THREE.SphereGeometry(.075,16,8),materials.white,0,height/2-.075,0);
    }
  }

  // Suspension anchors belong to the sprung chassis; each hub has independent travel.
  const car=new THREE.Group();car.name='rc-car';car.userData.kind='rc-car';group.add(car);
  const chassis = new THREE.Group(); chassis.name = 'rc-chassis'; car.add(chassis);
  const placeholderBody = createTrxTruck(materials).chassis;
  placeholderBody.name = 'rc-procedural-body'; chassis.add(placeholderBody);
  if (options.vehicleProfile) {
    const profile = options.vehicleProfile;
    const bounds = new THREE.Box3().setFromObject(placeholderBody), size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    placeholderBody.scale.set(profile.halfWidth * 2 / size.x, profile.halfHeight * 2 / size.y, profile.halfLength * 2 / size.z);
    placeholderBody.position.copy(center).multiply(placeholderBody.scale).negate();
    placeholderBody.position.y += profile.centerOffset;
  }

  const wheels:THREE.Group[]=[];
  const rotors: THREE.Object3D[] = [];
  for(let i=0;i<4;i++) {
    const wheel=new THREE.Group(); wheel.name = `rc-wheel-hub-${i}`; chassis.add(wheel);wheels.push(wheel);
    const rotor=createTrxWheel(materials); rotor.scale.setScalar(physics.vehicle.wheelRadius / .19); wheel.add(rotor); rotors.push(rotor);
  }
  const suspension = createTrxSuspension(chassis, materials, options.vehicleProfile ?? physics.vehicle);
  const antennaLinks:THREE.Mesh[]=[];
  // Each cylinder follows a simulated chain segment; no per-frame geometry allocation.
  const antennaRadius = options.vehicleProfile?.antennaRadius ?? .008;
  for(let i=0;i<10;i++) {
    const link = addMesh(chassis,new THREE.CylinderGeometry(antennaRadius,antennaRadius,1,6),materials.dark);
    link.name = `rc-antenna-link-${i}`; antennaLinks.push(link);
  }
  const antennaTip=addMesh(chassis,new THREE.SphereGeometry(options.vehicleProfile?.antennaTipRadius ?? .035,12,8),materials.red);
  antennaTip.name = 'rc-antenna-tip';
  const antennaBase=physics.state.antenna[0];
  const mountScale=options.vehicleProfile?.antennaMountScale ?? modelScale;
  const antennaMount=addMesh(chassis,new THREE.CylinderGeometry(.038*mountScale,.05*mountScale,.08*mountScale,12),materials.dark,
    antennaBase.x,antennaBase.y+.005*mountScale,antennaBase.z); antennaMount.name='rc-antenna-mount';
  const effects=createVehicleEffects(group,chassis,physics,surface);

  const targetMarker=new THREE.Group();targetMarker.name='rc-target';group.add(targetMarker);targetMarker.visible=false;
  const targetMat=new THREE.MeshBasicMaterial({color:'#16803d',transparent:true,opacity:.7,depthWrite:false,side:THREE.DoubleSide});
  const targetRing=addMesh(targetMarker,new THREE.RingGeometry(.19,.235,40),targetMat);targetRing.rotation.x=-Math.PI/2;targetRing.castShadow=false;
  for(const side of [-1,1]) {
    const tick=addMesh(targetMarker,new THREE.PlaneGeometry(.045,.12),targetMat,side*.30,0,0);tick.rotation.x=-Math.PI/2;tick.castShadow=false;
  }
  const linePositions=new Float32Array(6);
  const lineGeometry=new THREE.BufferGeometry();lineGeometry.setAttribute('position',new THREE.BufferAttribute(linePositions,3));
  const targetLine=new THREE.Line(lineGeometry,new THREE.LineDashedMaterial({color:'#16803d',transparent:true,opacity:.25,dashSize:.15,gapSize:.15}));
  targetLine.name='rc-guide';targetLine.frustumCulled=false;group.add(targetLine);targetLine.visible=false;
  const skidPositions=new Float32Array(360*18);const skidGeometry=new THREE.BufferGeometry();
  skidGeometry.setAttribute('position',new THREE.BufferAttribute(skidPositions,3));skidGeometry.setDrawRange(0,0);
  const skidLines=new THREE.Mesh(skidGeometry,new THREE.MeshBasicMaterial({color:'#3f352a',transparent:true,opacity:.26,
    depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  skidLines.name='rc-skid-marks';skidLines.frustumCulled=false;group.add(skidLines);
  let skidCount=0;const lastSkid:Array<THREE.Vector3|null>=[null,null];


  let mode:RcMode='free',disposed=false;
  let vehicleRig: RcVehicleRig | null = null, requestedColor = '#e8bc45';
  let checkpoint=0,lap=0,elapsed=0,trialStarted=false,best:number|null=null;
  let accumulator=0;
  const segment=new THREE.Vector3();const pointA=new THREE.Vector3();const pointB=new THREE.Vector3();
  try {const stored=Number(localStorage.getItem(BEST_KEY));if(Number.isFinite(stored)&&stored>0)best=stored;}catch{/* storage can be blocked in an embedded site */}

  function collideArchitecture() {
    const state=physics.state;
    const halfWidth = options.vehicleProfile?.halfWidth ?? .71, halfLength = options.vehicleProfile?.halfLength ?? 1.04;
    const marginX=Math.abs(Math.cos(state.yaw))*halfWidth+Math.abs(Math.sin(state.yaw))*halfLength;
    const marginZ=Math.abs(Math.sin(state.yaw))*halfWidth+Math.abs(Math.cos(state.yaw))*halfLength;
    for (const barrier of surface.barriers ?? []) {
      if (state.y-.1 > barrier.height) continue;
      const minX=barrier.minX-marginX,maxX=barrier.maxX+marginX,minZ=barrier.minZ-marginZ,maxZ=barrier.maxZ+marginZ;
      if(state.x<=minX||state.x>=maxX||state.z<=minZ||state.z>=maxZ)continue;
      const distances=[state.x-minX,maxX-state.x,state.z-minZ,maxZ-state.z];
      const side=distances.indexOf(Math.min(...distances));
      const nx=side===0?-1:side===1?1:0,nz=side===2?-1:side===3?1:0;
      if(nx)state.x=nx<0?minX:maxX;else state.z=nz<0?minZ:maxZ;
      const approach=Math.max(0,-(state.vx*nx+state.vz*nz));
      physics.bump(nx,nz,approach*1.15);
    }
  }
  function renderProps() {
    props.bodies.forEach((body,i)=>{
      propMeshes[i].position.set(body.position.x,body.position.y,body.position.z);
      propMeshes[i].quaternion.set(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w);
    });
  }
  function updateCheckpoints(dt:number,driving:boolean) {
    if(mode!=='trial')return;
    if(driving)trialStarted=true;
    if(trialStarted)elapsed+=dt;
    const point=CHECKPOINTS[checkpoint];
    if(trialStarted&&Math.hypot(physics.state.x-point.x,physics.state.z-point.z)<1.25){
      checkpoint++;
      if(checkpoint===CHECKPOINTS.length){
        const time=elapsed;lap++;checkpoint=0;elapsed=0;trialStarted=false;
        if(best===null||time<best){best=time;try{localStorage.setItem(BEST_KEY,String(best));}catch{/* optional persistence */}}
        options.onLap?.(time);
      }
    }
  }
  function renderCar() {
    const state=physics.state;car.position.set(state.x,state.y,state.z);car.rotation.y=state.yaw;
    chassis.rotation.set(state.pitch,0,state.roll);
    state.wheels.forEach((wheel,i)=>{
      wheels[i].position.set(wheel.x,wheel.height,wheel.z);wheels[i].rotation.y=i<2?(wheel.steer ?? state.steer):0;
      rotors[i].rotation.x=wheel.spin ?? state.wheelSpin;
    });
    suspension.update(state.wheels);
    const points=state.antenna;
    for(let i=0;i<antennaLinks.length;i++) {
      const a=points[Math.floor(i*(points.length-1)/antennaLinks.length)];
      const b=points[Math.floor((i+1)*(points.length-1)/antennaLinks.length)];
      if(!a||!b)continue;
      pointA.set(a.x,a.y,a.z);pointB.set(b.x,b.y,b.z);segment.subVectors(pointB,pointA);
      antennaLinks[i].position.copy(pointA).add(pointB).multiplyScalar(.5);
      antennaLinks[i].scale.y=segment.length();antennaLinks[i].quaternion.setFromUnitVectors(UP,segment.normalize());
    }
    const tip=points[points.length-1];antennaTip.position.set(tip.x,tip.y,tip.z);
  }
  function visualFeedback(control:CarInput,dt:number,showTarget:boolean) {
    targetMarker.visible=showTarget&&!!control.target;targetLine.visible=showTarget&&control.throttle>0&&!!control.target;
    if(control.target) {
      targetMarker.position.set(control.target.x,terrainHeight(control.target.x,control.target.z)+.02,control.target.z);
      targetMarker.rotation.y+=dt*.9;
      linePositions.set([physics.state.x,terrainHeight(physics.state.x,physics.state.z)+.025,physics.state.z,control.target.x,terrainHeight(control.target.x,control.target.z)+.025,control.target.z]);
      lineGeometry.attributes.position.needsUpdate=true;targetLine.computeLineDistances();
    }
    checkpointGroups.forEach((group,i)=>{
      const active=mode==='trial'&&i===checkpoint;
      checkpointMats[i].color.set(active?'#16803d':'#a5b9a8');
      checkpointRings[i].visible=active;
      markerLabels[i].visible=active;
    });
    const state=physics.state;
    if(Math.hypot(state.vx,state.vz)>.9&&(control.brake||control.handbrake||Math.abs(state.slipAngle??0)>.12)) {
      state.wheels.slice(2).forEach((wheel,index)=>{
        if(!wheel.contact){lastSkid[index]=null;return;}
        const position=new THREE.Vector3(wheel.x,wheel.height,wheel.z).applyEuler(chassis.rotation).applyAxisAngle(UP,state.yaw);
        position.x+=state.x;position.z+=state.z;
        const previous=lastSkid[index];
        if(previous&&Math.hypot(previous.x-position.x,previous.z-position.z)>.045){
          const dx=position.x-previous.x,dz=position.z-previous.z,halfWidth=physics.vehicle.wheelRadius*.19;
          const length=Math.hypot(dx,dz),ox=-dz/length*halfWidth,oz=dx/length*halfWidth;
          const corners=[ [previous.x+ox,previous.z+oz],[previous.x-ox,previous.z-oz],
            [position.x+ox,position.z+oz],[position.x-ox,position.z-oz] ];
          const offset=(skidCount%360)*18;
          [0,1,2,2,1,3].forEach((corner,i)=>{
            const [x,z]=corners[corner];skidPositions.set([x,terrainHeight(x,z)+.007,z],offset+i*3);
          });
          skidCount++;skidGeometry.attributes.position.needsUpdate=true;skidGeometry.setDrawRange(0,Math.min(skidCount,360)*6);
          previous.copy(position);
        }else if(!previous)lastSkid[index]=position;
      });
    }else lastSkid.fill(null);
  }

  function reset() {
    if(disposed)return;
    physics.reset();props.reset();checkpoint=lap=elapsed=0;trialStarted=false;accumulator=0;
    skidCount=0;lastSkid.fill(null);skidGeometry.setDrawRange(0,0);effects.reset();
    renderCar();renderProps();visualFeedback(NEUTRAL_INPUT,0,false);
  }

  const world:RcWorld={
    group,
    physics,
    props,
    surface,
    step(dt,input){
      if(disposed||!Number.isFinite(dt)||dt<=0)return;
      accumulator=Math.min(accumulator+Math.min(dt,.05),.075);
      while(accumulator>=1/120){
        physics.step(1/120,input);collideArchitecture();props.step(1/120,physics);effects.step(1/120,input);updateCheckpoints(1/120,input.throttle>0);accumulator-=1/120;
      }
    },
    update(input,dt,showTarget=true){
      if(disposed)return;
      renderCar();renderProps();effects.render(input);visualFeedback(input,Number.isFinite(dt)?clamp(dt,0,.05):0,showTarget);
    },
    reset,
    setMode(value){if(disposed)return;mode=value;reset();},
    setColor(hex){if(!disposed&&/^#[0-9a-f]{6}$/i.test(hex)){requestedColor=hex;materials.body.color.set(hex);vehicleRig?.setColor(hex);}},
    setLighting(night){if(!disposed)effects.setLighting(night);},
    getTelemetry(paused=false,driving=false){
      return {speed:Math.abs(physics.state.speed)*3.6,elapsed,checkpoint,checkpoints:CHECKPOINTS.length,lap,paused,driving,
        suspension:physics.state.wheels.map(w=>clamp(.5 + .5 * w.compression
          / (w.compression >= 0 ? SUSPENSION_COMPRESSION_TRAVEL : SUSPENSION_REBOUND_TRAVEL),0,1)),best};
    },
    dispose(){
      if(disposed)return;disposed=true;
      props.dispose();
      if (vehicleRig) {
        vehicleRig.body.removeFromParent(); vehicleRig.rotors.forEach(rotor => rotor.removeFromParent());
        vehicleRig.dispose(); vehicleRig = null;
      }
      disposeObjects([group]);
      group.removeFromParent();group.clear();
    },
  };
  reset();
  if (options.loadVehicle) {
    Promise.resolve().then(options.loadVehicle).then(rig => {
      if (disposed) { rig.dispose(); return; }
      rig.setColor(requestedColor);
      const retired: THREE.Object3D[] = [placeholderBody, ...rotors];
      retired.forEach(object => object.removeFromParent());
      vehicleRig = rig; rig.body.scale.multiplyScalar(modelScale); chassis.add(rig.body);
      rig.rotors.forEach((rotor, i) => { rotor.scale.multiplyScalar(modelScale); rotors[i] = rotor; wheels[i].add(rotor); });
      disposeObjects(retired, [group]);
      car.userData.vehicle = 'ram-trx-sketchfab';
      renderCar(); options.onVehicleReady?.();
    }).catch(error => { if (!disposed) options.onVehicleError?.(error); });
  }
  return world;
}
