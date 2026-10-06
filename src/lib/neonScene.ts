import * as THREE from 'three';
import { createNeonDesign, neonBackerOutline, neonHolderPositions } from './neonConstruction';

class CenterlineCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private points: THREE.Vector3[]) { super(); }
  getPoint(t: number, target = new THREE.Vector3()) {
    const index=Math.min(this.points.length-2,Math.floor(t*(this.points.length-1)));
    const fraction=t*(this.points.length-1)-index;
    return target.copy(this.points[index]).lerp(this.points[index+1],fraction);
  }
  getPointAt(t: number, target = new THREE.Vector3()) { return this.getPoint(t,target); }
  getTangentAt(t: number, target = new THREE.Vector3()) {
    return target.copy(this.getPoint(Math.min(1,t+.00001))).sub(this.getPoint(Math.max(0,t-.00001))).normalize();
  }
}

export function createNeonModel(project: { neonText?: string; neonFont?: string; neonHeight?: number; neonDiameter?: number; neonColor?: string; neonBackerShape?:string; neonBrightness?:number; neonAlign?:string }, width: number, height: number) {
  const group = new THREE.Group();
  const diameter = project.neonDiameter ?? 6, color = project.neonColor ?? '#ff9854';
  const design = createNeonDesign(project.neonText ?? 'СВЕТ', project.neonHeight ?? 200, diameter, project.neonFont ?? 'rounded',project.neonAlign);
  const power=(project.neonBrightness??85)/100;
  const outline=neonBackerOutline(design,width,height,project.neonBackerShape??'rectangle');
  const shape=new THREE.Shape();outline.forEach(([x,y],i)=>i?shape.lineTo(x-width/2,height/2-y):shape.moveTo(x-width/2,height/2-y));shape.closePath();
  const acrylic = new THREE.MeshPhysicalMaterial({ color:'#e8fffa', transparent:true, opacity:.14, roughness:.08, metalness:0, clearcoat:1, clearcoatRoughness:.05, depthWrite:false, side:THREE.DoubleSide });
  const backer = new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:3,bevelEnabled:false}),acrylic); backer.position.z=20; backer.name='transparent-acrylic-backer'; group.add(backer);
  const steel = new THREE.MeshStandardMaterial({color:'#abbeb7',metalness:.8,roughness:.25});
  for(const [px,py] of neonHolderPositions(outline,width,height)) {
    const x=px-width/2,y=height/2-py;
    const holder = new THREE.Mesh(new THREE.CylinderGeometry(7,7,20,16),steel); holder.rotation.x=Math.PI/2; holder.position.set(x,y,10); holder.name='neon-standoff-20mm'; holder.castShadow=true; group.add(holder);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(8,8,3,16),steel); screw.rotation.x=Math.PI/2; screw.position.set(x,y,24); group.add(screw);
  }
  const tube = new THREE.MeshPhysicalMaterial({color,roughness:.3,clearcoat:1,clearcoatRoughness:.18,emissive:color,emissiveIntensity:1.8*power});
  const core = new THREE.MeshBasicMaterial({color:'#fff3e5',transparent:true,opacity:.8,toneMapped:false}); core.userData.neonCore=true;
  core.userData.neonBrightness=power;
  const aura = new THREE.MeshBasicMaterial({color,transparent:true,opacity:.055,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}); aura.userData.neonAura=true;
  for(const points of design.paths) {
    if(points.length<2) continue;
    const positions = points.map(([x,y])=>new THREE.Vector3(x-design.width/2,design.height/2-y,23+diameter/2));
    const curve = new CenterlineCurve(positions);
    const segments=Math.max(16,positions.length*2);
    const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,segments,diameter/2,10,false),tube); mesh.name='neon-tube'; mesh.castShadow=true; group.add(mesh);
    const highlight=new THREE.Mesh(new THREE.TubeGeometry(curve,segments,diameter*.13,6,false),core); highlight.position.z=diameter*.42; group.add(highlight);

  }
  aura.dispose();
  if (typeof document !== 'undefined') {
    const canvas=document.createElement('canvas'); canvas.width=1024; canvas.height=Math.max(128,Math.round(height/width*1024));
    const context=canvas.getContext('2d')!; const scale=canvas.width/width;
    context.scale(scale,scale); context.translate((width-design.width)/2,(height-design.height)/2);
    context.lineCap='round'; context.lineJoin='round'; context.strokeStyle=color; context.lineWidth=diameter*1.2;
    context.shadowColor=color; context.shadowBlur=diameter*4*scale;
    for(const points of design.paths) { context.beginPath(); points.forEach(([x,y],i)=>i?context.lineTo(x,y):context.moveTo(x,y)); context.stroke(); }
    const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.8*power,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}); material.userData.lightOpacity=.8*power;
    const glow=new THREE.Mesh(new THREE.PlaneGeometry(width,height),material); glow.position.z=23.2; glow.name='neon-light-spill'; glow.renderOrder=2; group.add(glow);
  }
  return group;
}
