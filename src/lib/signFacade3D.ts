import * as THREE from 'three';
import { facadeRects } from './signFacade';
import type { SignPlacement } from './signFacade';
export function createFacadeModel(place: SignPlacement, signWidth:number, signHeight:number) {
  const group=new THREE.Group(); group.name='facade';
  if(place==='none')return group;
  const scale=Math.max(signWidth/290,signHeight/65,8);
  const dayRects=facadeRects(place,false),nightRects=facadeRects(place,true);
  for(const [index,r] of dayRects.entries()) {
    const material=new THREE.MeshStandardMaterial({color:r.color,roughness:index===0?.88:.35,metalness:index===0?0:.12});
    material.userData.dayColor=material.color.clone();
    if(r.color==='#85a8ac'){material.emissive.set(nightRects[index].color);material.userData.maxEmission=.5;}
    const z=(r.z??-20)- (place==='canopy' && index<4 ? 60:0);
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(r.w*scale,r.h*scale,index===0?35:8),material);
    mesh.position.set((r.x+r.w/2-250)*scale,(85-r.y-r.h/2)*scale,z);
    mesh.receiveShadow=true; mesh.castShadow=index>0; mesh.name=index===0?'facade-wall':'facade-detail'; group.add(mesh);
  }
  return group;
}
