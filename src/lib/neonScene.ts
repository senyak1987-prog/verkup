import * as THREE from 'three';
import { createNeonDesign, neonBackerOutline, neonHolderPositions, neonDesignPlacement } from './neonConstruction';

class CenterlineCurve extends THREE.Curve<THREE.Vector3> {
  private distances:number[]=[0];
  private totalLength:number;
  private tangents:THREE.Vector3[];
  constructor(private points: THREE.Vector3[]) {
    super();
    for(let index=1;index<points.length;index++)this.distances.push(this.distances[index-1]+points[index].distanceTo(points[index-1]));
    this.totalLength=this.distances[this.distances.length-1];
    this.tangents=points.map((_,index)=>points[Math.min(points.length-1,index+1)].clone().sub(points[Math.max(0,index-1)]).normalize());
    if(points.length>2&&points[0].distanceTo(points[points.length-1])<.001){const seam=points[1].clone().sub(points[points.length-2]).normalize();this.tangents[0]=seam;this.tangents[this.tangents.length-1]=seam.clone();}
  }
  private locate(t:number) {
    const distance=THREE.MathUtils.clamp(t,0,1)*this.totalLength;let low=0,high=this.distances.length-1;
    while(high-low>1){const middle=(low+high)>>1;if(this.distances[middle]<=distance)low=middle;else high=middle;}
    return {index:low,fraction:(distance-this.distances[low])/(this.distances[low+1]-this.distances[low]||1)};
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const {index,fraction}=this.locate(t);
    return target.copy(this.points[index]).lerp(this.points[index+1],fraction);
  }
  getPointAt(t: number, target = new THREE.Vector3()) { return this.getPoint(t,target); }
  getTangentAt(t: number, target = new THREE.Vector3()) {
    const {index,fraction}=this.locate(t);
    return target.copy(this.tangents[index]).lerp(this.tangents[index+1],fraction).normalize();
  }
}

export function createNeonModel(project: { neonText?: string; neonFont?: string; neonHeight?: number; neonDiameter?: number; neonColor?: string; neonBackerShape?:string; neonBrightness?:number; neonAlign?:string;lightsOn?:boolean;neonBackerColor?:'clear'|'white'|'black';neonInstallMode?:'standoffs'|'hanging';neonLineFonts?:readonly string[];neonLineColors?:readonly string[];neonLineScales?:readonly number[];neonLineOffsets?:readonly {x:number;y:number}[];neonIcon?:string;neonTargetWidth?:number;neonKeepAspect?:boolean;neonLetterSpacing?:number;neonLineSpacing?:number }, width: number, height: number) {
  const group = new THREE.Group();
  const diameter = project.neonDiameter ?? 6, color = project.neonColor ?? '#ff9854';
  const design = createNeonDesign(project.neonText ?? 'СВЕТ', project.neonHeight ?? 200, diameter, project.neonFont ?? 'rounded',project.neonAlign,{lineFonts:project.neonLineFonts,lineColors:project.neonLineColors,lineScales:project.neonLineScales,lineOffsets:project.neonLineOffsets,icon:project.neonIcon,targetWidth:project.neonKeepAspect?undefined:project.neonTargetWidth,letterSpacing:project.neonLetterSpacing,lineSpacing:project.neonLineSpacing});
  const placement=neonDesignPlacement(design,width,height);
  const power=(project.neonBrightness??85)/100,lightsOn=project.lightsOn!==false,backerColor=project.neonBackerColor??'clear';
  const outline=neonBackerOutline(design,width,height,project.neonBackerShape??'rectangle');
  const shape=new THREE.Shape();outline.forEach(([x,y],i)=>i?shape.lineTo(x-width/2,height/2-y):shape.moveTo(x-width/2,height/2-y));shape.closePath();
  const acrylic = new THREE.MeshPhysicalMaterial({ color:backerColor==='black'?'#171a20':backerColor==='white'?'#f5f4ef':'#f0f8ff', transparent:backerColor==='clear', opacity:backerColor==='clear'?.14:1, roughness:backerColor==='clear'?.18:.45, metalness:0, clearcoat:.45, clearcoatRoughness:.2, depthWrite:backerColor!=='clear', side:THREE.DoubleSide });
  const backer = new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:3,bevelEnabled:false}),acrylic); backer.position.z=20; backer.name='transparent-acrylic-backer';backer.castShadow=backerColor!=='clear';backer.receiveShadow=true;group.add(backer);
  if(backerColor==='clear') {
    const edge=new THREE.LineSegments(new THREE.EdgesGeometry(backer.geometry,30),new THREE.LineBasicMaterial({color:'#b9ceda',transparent:true,opacity:.46,depthWrite:false}));
    edge.position.copy(backer.position);edge.name='neon-acrylic-polished-edge';group.add(edge);
  }
  const steel = new THREE.MeshStandardMaterial({color:'#b4bac1',metalness:.65,roughness:.4});
  const holders=neonHolderPositions(outline,width,height);
  for(const [px,py] of (project.neonInstallMode==='hanging'?holders.slice(0,2):holders)) {
    const x=px-width/2,y=height/2-py;
    if(project.neonInstallMode==='hanging') {
      const eyelet=new THREE.Mesh(new THREE.TorusGeometry(5,1,6,16),steel);eyelet.position.set(x,y,24);eyelet.name='neon-hanging-eyelet';group.add(eyelet);
      const cableLength=Math.max(70,height*.2),cable=new THREE.Mesh(new THREE.CylinderGeometry(.65,.65,cableLength,6),steel);cable.position.set(x,y+cableLength/2,24);cable.name='neon-hanging-cable';group.add(cable);
      continue;
    }
    const holder = new THREE.Mesh(new THREE.CylinderGeometry(7,7,20,16),steel); holder.rotation.x=Math.PI/2; holder.position.set(x,y,10); holder.name='neon-standoff-20mm'; holder.castShadow=true; group.add(holder);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(8,8,3,16),steel); screw.rotation.x=Math.PI/2; screw.position.set(x,y,24); group.add(screw);
  }
  const tubeMaterials=new Map<string,THREE.MeshPhysicalMaterial>();
  const materialFor=(value:string)=>{let material=tubeMaterials.get(value);if(!material){material=new THREE.MeshPhysicalMaterial({color:value,roughness:.42,clearcoat:.28,clearcoatRoughness:.4,emissive:value,emissiveIntensity:lightsOn?1.8*power:0});material.userData.neonEmission=1.8*power;tubeMaterials.set(value,material);}return material;};
  const core = new THREE.MeshBasicMaterial({color:'#fff5e8',transparent:true,opacity:lightsOn?.8*power:0,depthWrite:false,toneMapped:false}); core.userData.neonCore=true;
  core.userData.neonBrightness=power;
  for(let pathIndex=0;pathIndex<design.paths.length;pathIndex++) {
    const points=design.paths[pathIndex],tube=materialFor(design.pathColors?.[pathIndex]??color);
    if(points.length<2) continue;
    const positions = points.map(([x,y])=>new THREE.Vector3(placement.x+x-width/2,height/2-placement.y-y,23+diameter/2));
    const curve = new CenterlineCurve(positions);
    const visibleLength=positions.reduce((sum,p,index)=>sum+(index?p.distanceTo(positions[index-1]):0),0);
    const segments=Math.max(16,Math.min(1200,Math.ceil(visibleLength/Math.min(2.5,diameter*.4))));
    const closed=positions[0].distanceTo(positions[positions.length-1])<.001;
    const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,segments,diameter/2,12,closed),tube); mesh.name='neon-tube'; mesh.castShadow=true; group.add(mesh);
    const highlight=new THREE.Mesh(new THREE.TubeGeometry(curve,segments,diameter*.13,6,closed),core); highlight.position.z=diameter*.42; highlight.name='neon-light-core';group.add(highlight);
    if(!closed)for(const endpoint of [positions[0],positions[positions.length-1]]) {
      const cap=new THREE.Mesh(new THREE.SphereGeometry(diameter/2,12,8),tube);cap.position.copy(endpoint);cap.name='neon-rounded-end';cap.castShadow=true;group.add(cap);
      const tip=new THREE.Mesh(new THREE.SphereGeometry(diameter*.13,8,6),core);tip.position.copy(endpoint);tip.position.z+=diameter*.42;tip.name='neon-core-end';group.add(tip);
    }
  }
  if (typeof document !== 'undefined') {
    const canvas=document.createElement('canvas'),spillPad=Math.max(40,diameter*7),spillWidth=width+spillPad*2,spillHeight=height+spillPad*2;
    canvas.width=Math.max(128,Math.round(1024*Math.min(1,spillWidth/spillHeight)));canvas.height=Math.max(128,Math.round(1024*Math.min(1,spillHeight/spillWidth)));
    const context=canvas.getContext('2d')!; const scaleX=canvas.width/spillWidth,scaleY=canvas.height/spillHeight;
    context.scale(scaleX,scaleY); context.translate(placement.x+spillPad,placement.y+spillPad);
    context.lineCap='round'; context.lineJoin='round'; context.strokeStyle=color; context.lineWidth=diameter*1.2;
    context.shadowColor=color; context.shadowBlur=diameter*4*Math.sqrt(scaleX*scaleY);
    design.paths.forEach((points,index)=>{const pathColor=design.pathColors?.[index]??color;context.strokeStyle=pathColor;context.shadowColor=pathColor;context.beginPath();points.forEach(([x,y],i)=>i?context.lineTo(x,y):context.moveTo(x,y));context.stroke();});
    const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:lightsOn?.8*power:0,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}); material.userData.lightOpacity=.8*power;material.userData.neonSpill=true;
    const glow=new THREE.Mesh(new THREE.PlaneGeometry(spillWidth,spillHeight),material); glow.position.z=23.2; glow.name='neon-light-spill'; glow.renderOrder=2; group.add(glow);
  }
  return group;
}
