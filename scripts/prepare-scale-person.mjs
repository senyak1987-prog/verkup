/** Bake the CC0 Quaternius rig into a standing, smoothly subdivided, static GLB.
 * Usage: node scripts/prepare-scale-person.mjs path/to/character.glb
 * Source and license: public/models/README.md. No Blender or remote runtime dependencies.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const source=fs.readFileSync(process.argv[2]);
const gltf=await new GLTFLoader().parseAsync(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength),'');
const rig=gltf.scene;rig.updateMatrixWorld(true);
function aim(name,childName,direction){
  const bone=rig.getObjectByName(name),child=rig.getObjectByName(childName);
  const current=child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
  const parent=bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const delta=new THREE.Quaternion().setFromUnitVectors(current,direction.normalize());
  bone.quaternion.premultiply(parent.clone().invert().multiply(delta).multiply(parent));rig.updateMatrixWorld(true);
}
for(const side of ['l','r']){
  const bone=rig.getObjectByName('upperarm_'+side),sign=Math.sign(bone.getWorldPosition(new THREE.Vector3()).x);
  aim('upperarm_'+side,'lowerarm_'+side,new THREE.Vector3(sign*.16,-1,.025));
  aim('lowerarm_'+side,'hand_'+side,new THREE.Vector3(sign*.03,-1,.09));
}
const head=rig.getObjectByName('Head');head.rotateX(.1);rig.updateMatrixWorld(true);
rig.traverse(mesh=>{if(mesh.isSkinnedMesh)mesh.skeleton.update();});

// Weld texture seams before Loop subdivision; the final static model needs no UV seams.
function subdivide(positions,colors,indices){
  const edges=new Map(),neighbours=positions.map(()=>new Set()),boundaries=positions.map(()=>[]);
  const edge=(a,b,c)=>{const key=a<b?a+','+b:b+','+a;let e=edges.get(key);if(!e){e={a,b,opposite:[]};edges.set(key,e);}e.opposite.push(c);neighbours[a].add(b);neighbours[b].add(a);};
  for(let i=0;i<indices.length;i+=3){const[a,b,c]=indices.slice(i,i+3);edge(a,b,c);edge(b,c,a);edge(c,a,b);}
  for(const e of edges.values())if(e.opposite.length===1){boundaries[e.a].push(e.b);boundaries[e.b].push(e.a);}
  const next=positions.map((p,i)=>{
    const boundary=boundaries[i],n=neighbours[i].size,beta=n===3?3/16:3/(8*n);
    return p.map((v,k)=>boundary.length===2?v*.75+(positions[boundary[0]][k]+positions[boundary[1]][k])/8:
      v*(1-n*beta)+[...neighbours[i]].reduce((sum,j)=>sum+positions[j][k]*beta,0));
  }),nextColors=colors.map(c=>c.slice());
  for(const e of edges.values()){
    e.index=next.length;
    next.push(positions[e.a].map((v,k)=>e.opposite.length===2?(v+positions[e.b][k])*3/8+(positions[e.opposite[0]][k]+positions[e.opposite[1]][k])/8:(v+positions[e.b][k])/2));
    nextColors.push(colors[e.a].map((v,k)=>(v+colors[e.b][k])/2));
  }
  const get=(a,b)=>edges.get(a<b?a+','+b:b+','+a).index,out=[];
  for(let i=0;i<indices.length;i+=3){const[a,b,c]=indices.slice(i,i+3),ab=get(a,b),bc=get(b,c),ca=get(c,a);out.push(a,ab,ca,b,bc,ab,c,ca,bc,ab,bc,ca);}
  return {positions:next,colors:nextColors,indices:out};
}
const meshes=[];
rig.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;
  const source=mesh.geometry,p=source.getAttribute('position'),joints=source.getAttribute('skinIndex'),weights=source.getAttribute('skinWeight');
  const position=new THREE.Vector3(),positions=[],colors=[],indexMap=[],weld=new Map();
  for(let i=0;i<p.count;i++){
    position.fromBufferAttribute(p,i);mesh.applyBoneTransform(i,position);position.applyMatrix4(mesh.matrixWorld);
    const key=position.toArray().map(v=>v.toFixed(6)).join(',');
    if(weld.has(key)){indexMap.push(weld.get(key));continue;}
    let color;
    if(mesh.name==='Eyebrows')color='#322923';
    else if(mesh.name==='Eyes')color='#ece7da';
    else{
      let skin=0;
      for(let k=0;k<4;k++){const bone=mesh.skeleton.bones[joints.getComponent(i,k)].name;
        if(/Head|neck|hand|thumb|index|middle|ring|pinky/.test(bone))skin+=weights.getComponent(i,k);}
      color=skin>.52?'#c39778':'#173e60';
      if(position.y<.40)color='#8e3430';
      if(position.y>.94&&position.y<.985)color='#b59a57';
    }
    weld.set(key,positions.length);indexMap.push(positions.length);positions.push(position.toArray());colors.push(new THREE.Color(color).toArray());
  }
  const originalIndex=source.getIndex(),indices=Array.from({length:originalIndex.count},(_,i)=>indexMap[originalIndex.getX(i)]);
  let smooth={positions,colors,indices};for(let step=0;step<2;step++)smooth=subdivide(smooth.positions,smooth.colors,smooth.indices);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(smooth.positions.flat(),3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(smooth.colors.flat(),3));geometry.setIndex(smooth.indices);geometry.computeVertexNormals();
  meshes.push({name:mesh.name==='SuperHero_Male'?'superhero-authored-body':mesh.name,geometry});
});
const bounds=new THREE.Box3();for(const{geometry}of meshes){geometry.computeBoundingBox();bounds.union(geometry.boundingBox);}
const scale=1750/(bounds.max.y-bounds.min.y),center=bounds.getCenter(new THREE.Vector3());
for(const{geometry}of meshes){geometry.translate(-center.x,-bounds.min.y,-center.z);geometry.scale(scale,scale,scale);}
// Small GLB writer: static position/normal/colour/index attributes, no images or skeleton at runtime.
const chunks=[],views=[],accessors=[],jsonMeshes=[],nodes=[];let byteLength=0;
function attribute(array,type,target){
  const data=Buffer.from(array.buffer,array.byteOffset,array.byteLength);views.push({buffer:0,byteOffset:byteLength,byteLength:data.length,target});chunks.push(data);byteLength+=data.length;
  const pad=(4-byteLength%4)%4;if(pad){chunks.push(Buffer.alloc(pad));byteLength+=pad;}
  const accessor={bufferView:views.length-1,componentType:array instanceof Uint32Array?5125:5126,count:array.length/(type==='VEC3'?3:1),type};
  if(type==='VEC3'){accessor.min=[Infinity,Infinity,Infinity];accessor.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<array.length;i++){
    accessor.min[i%3]=Math.min(accessor.min[i%3],array[i]);accessor.max[i%3]=Math.max(accessor.max[i%3],array[i]);}}
  accessors.push(accessor);return accessors.length-1;
}
for(const{name,geometry}of meshes){
  const attributes={};for(const[key,gltfName]of [['position','POSITION'],['normal','NORMAL'],['color','COLOR_0']])attributes[gltfName]=attribute(geometry.getAttribute(key).array,'VEC3',34962);
  const indices=attribute(new Uint32Array(geometry.getIndex().array),'SCALAR',34963);
  nodes.push({name,mesh:jsonMeshes.length});jsonMeshes.push({name,primitives:[{attributes,indices,material:0}]});
}
const json={asset:{version:'2.0',generator:'Quaternius CC0 model, posed and subdivided for Gorod Svet',extras:{source:'https://quaternius.com/packs/universalbasecharacters.html',sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),heightMm:1750}},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],nodes,meshes:jsonMeshes,
  materials:[{name:'Superhero suit and skin',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.72}}],buffers:[{byteLength}],bufferViews:views,accessors};
let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const bin=Buffer.concat(chunks),header=Buffer.alloc(20),binaryHeader=Buffer.alloc(8);
header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+text.length+bin.length,8);header.writeUInt32LE(text.length,12);header.writeUInt32LE(0x4e4f534a,16);binaryHeader.writeUInt32LE(bin.length,0);binaryHeader.writeUInt32LE(0x004e4942,4);
fs.writeFileSync(new URL('../public/models/gorod-svet-hero.glb',import.meta.url),Buffer.concat([header,text,binaryHeader,bin]));
console.log(JSON.stringify({bytes:28+text.length+bin.length,meshes:meshes.map(m=>({name:m.name,vertices:m.geometry.getAttribute('position').count,triangles:m.geometry.getIndex().count/3})),sourceSha256:json.asset.extras.sourceSha256}));
