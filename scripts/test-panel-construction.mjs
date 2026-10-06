import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as THREE from "three";
const require = createRequire(import.meta.url);
function load(name, dependencies = {}) {
  const source = fs.readFileSync(new URL('../src/lib/' + name + '.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, key => dependencies[key] ?? require(key));
  return exports;
}
const mount = load('panelConstruction');
const svg = load('signPanelExport', { './panelConstruction': mount });
const glyphShapes = load('glyphShapes', { three: THREE, libtess: { default: require('libtess') } });
const scene = load('signSceneGeometry', { three: THREE, './panelConstruction': mount, './letterContours': {}, './neonScene': {}, './glyphShapes': glyphShapes });
const facade = load('signFacade', { './panelConstruction': mount });
const facadeScene = load('signFacade3D', { three: THREE, './signFacade': facade, './panelConstruction': mount });
const mountingModes=['wall','corner','corner-front','corner-side'];
const contactedWalls=mode=>mode==='corner'?['front','side']:mode==='corner-side'?['side']:['front'];
const close = (actual, expected, message, tolerance=.01) => assert.ok(Math.abs(actual-expected)<tolerance, `${message}: ${actual} != ${expected}`);
const named = (object,name) => {const items=[];object.traverse(child=>{if(child.name===name)items.push(child);});return items;};
function worldVertices(mesh) {
  mesh.updateWorldMatrix(true,false);
  const attr=mesh.geometry.getAttribute('position'),points=[];
  for(let i=0;i<attr.count;i++)points.push(new THREE.Vector3().fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld));
  return points;
}
for (const shape of ['circle','square','rounded']) test(shape + ': две консоли, отдельные пластины и корпус заданной глубины', async () => {
  for (const size of [200, 500, 2000]) for (const gap of [60, 120, 400]) {
    const project = { productId: 'panel', panelShape: shape, panelSize: size, panelWallGap: gap, panelCornerRadius: 90,
      sceneMode: 'day', panelFaceColor: {value:'#ffffff'}, panelSideColor: {value:'#172333'}, panelImage: '' };
    const model = await scene.buildSignModel(project, {}, size, size, 100, false);
    assert.equal(model.children.filter(item => item.name === 'bracket-arm').length, 2);
    assert.equal(model.children.filter(item => item.name === 'wall-mount-plate').length, 2);
    assert.equal(model.children.filter(item => item.name === 'wall-anchor').length, 4);
    assert.equal(model.children.filter(item => item.name === 'panel-rim').length, 2);
    const body = model.getObjectByName('panel-body');
    body.geometry.computeBoundingBox();
    assert.equal(body.geometry.boundingBox.max.z - body.geometry.boundingBox.min.z, 100);
    assert.equal(body.material[0], body.material[2], 'Общее лицевое покрытие с двух сторон');
    const wallX = -size / 2 - gap;
    for (const plate of model.children.filter(item => item.name === 'wall-mount-plate')) {
      const box = new THREE.Box3().setFromObject(plate);
      assert.equal(box.min.x, wallX, 'Пластина непосредственно касается стены');
    }
    for (const arm of model.children.filter(item => item.name === 'bracket-arm')) {
      const box = new THREE.Box3().setFromObject(arm);
      assert.ok(Math.abs(box.min.x - wallX - 5) < 0.001);
      assert.ok(box.max.x > -size / 2, 'Консоль входит в корпус');
    }
    const markup = svg.createPanelSvgMarkup({ shape, size, wallGap: gap, cornerRadius: 90, depth: 100,
      faceColor: '#fff', sideColor: '#172333', image: '', imageScale: 82, imageX: 0, imageY: 0, showDimensions: true });
    assert.equal((markup.match(/data-bracket-arm/g) ?? []).length, 2);
    assert.ok(markup.includes(gap + ' мм'));
    assert.doesNotMatch(markup, /NaN|Infinity|undefined/);
    scene.disposeSignObject(model);
  }
});
test('Скругление ограничено половиной стороны и не меняет наружный размер', () => {
  assert.equal(mount.panelConstruction(200,'rounded',120,300).radius, 100);
  assert.equal(mount.panelConstruction(500,'square',120,90).radius, 0);
});

test('Both support arms meet the real panel outline, including fully rounded small panels', async()=>{
  for(const shape of ['circle','square','rounded'])for(const size of [200,500,2000])for(const depth of [30,60,160]) {
    const project={productId:'panel',panelShape:shape,panelSize:size,panelWallGap:120,panelCornerRadius:300,
      sceneMode:'day',panelFaceColor:{value:'#ffffff'},panelSideColor:{value:'#172333'},panelImage:''};
    const model=await scene.buildSignModel(project,{},size,size,depth,false);
    model.updateMatrixWorld(true);
    const body=model.getObjectByName('panel-body');
    for(const arm of named(model,'bracket-arm')) {
      const box=new THREE.Box3().setFromObject(arm);
      const point=new THREE.Vector3(box.max.x-.5,arm.position.y,depth+100);
      const hit=new THREE.Raycaster(point,new THREE.Vector3(0,0,-1)).intersectObject(body,false)[0];
      assert.ok(hit,`${shape} ${size} x ${depth}: the arm end must enter the actual face outline`);
      close(hit.point.z,depth,'The arm enters the specified panel thickness');
      assert.ok(box.min.z>=0&&box.max.z<=depth,'The square support tube remains inside both faces');
    }
    scene.disposeSignObject(model);
  }
});

test('Wall and corner brackets touch the actual facade planes, retain physical size, and project away from the building', async()=>{
  for(const mode of mountingModes)for(const shape of ['circle','square','rounded'])for(const size of [200,500,2000])
    for(const depth of [30,60,160])for(const gap of [60,120,400]) {
      const pose=mount.panelMountLayout(size,shape,gap,300,depth,mode);
      const project={productId:'panel',panelShape:shape,panelSize:size,panelWallGap:gap,panelCornerRadius:300,panelMountMode:mode,
        sceneMode:'day',panelFaceColor:{value:'#ffffff'},panelSideColor:{value:'#172333'},panelImage:''};
      const model=await scene.buildSignModel(project,{},size,size,depth,false);
      const assembly=new THREE.Group(); assembly.add(model);
      model.rotation.y=pose.rotationY;
      model.position.set(pose.position.x,pose.position.y,pose.position.z);
      const architecture=facadeScene.createFacadeModel('windows',size,size,{palette:'brick',panelMount:pose});
      assembly.add(architecture); assembly.updateMatrixWorld(true);
      const planes=pose.worldPlanes.map(p=>({id:p.id,point:new THREE.Vector3(...p.point),normal:new THREE.Vector3(...p.normal)}));
      assert.equal(planes.length,mode==='wall'?1:2);
      assert.ok(planes.some(p=>p.id==='front'));
      if(mode!=='wall')assert.ok(planes.some(p=>p.id==='side'),'The building corner includes the return wall');
      for(const plane of planes)close(plane.normal.length(),1,'Wall normals have unit length');

      const body=model.getObjectByName('panel-body');
      const faceNormal=new THREE.Vector3(0,0,1).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion()));
      for(const plane of planes) {
        const expected=mode==='corner'?Math.SQRT1_2:contactedWalls(mode).includes(plane.id)?0:1;
        close(Math.abs(faceNormal.dot(plane.normal)),expected,
          'The panel follows the diagonal bisector or stands perpendicular to its selected attachment wall');
      }
      body.geometry.computeBoundingBox();
      close(body.geometry.boundingBox.max.z-body.geometry.boundingBox.min.z,depth,'Panel depth is never scaled by facade mounting');
      const bodyVertices=worldVertices(body);
      const attachment=planes.find(p=>p.id===contactedWalls(mode)[0]);
      const outward=mode==='corner'?planes.reduce((sum,p)=>sum.add(p.normal),new THREE.Vector3()).normalize():attachment.normal;
      const reference=mode==='corner'?new THREE.Vector3(planes.find(p=>p.id==='side').point.x,0,planes.find(p=>p.id==='front').point.z):attachment.point;
      const effectiveGap=mode==='corner'?Math.max(gap,depth/2+20):gap;
      close(pose.gap,effectiveGap,'Corner clearance accounts for both housing thickness and construction clearance');
      close(Math.min(...bodyVertices.map(v=>v.clone().sub(reference).dot(outward))),effectiveGap,
        'The requested wall gap remains a physical clearance along the support direction',.08);
      for(const vertex of bodyVertices) {
        const distances=planes.map(p=>vertex.clone().sub(p.point).dot(p.normal));
        assert.ok(mode==='wall'?distances[0]>=-0.01:distances.some(d=>d>=-.01),'The sign cannot intersect the building volume');
      }
      for(const bar of [...named(model,'bracket-arm'),...named(model,'corner-bracket-tie')])for(const vertex of worldVertices(bar)) {
        const distances=planes.map(p=>vertex.clone().sub(p.point).dot(p.normal));
        assert.ok(mode==='wall'?distances[0]>=-.01:distances.some(d=>d>=-.01),
          `${mode} ${shape} ${size} x ${depth} gap ${gap}: ${bar.name} must stay outside masonry (${distances.join(', ')})`);
      }

      const walls=[];architecture.traverse(child=>{if(child.userData.facadeKind==='wall')walls.push(child);});
      assert.equal(walls.length,mode==='wall'?1:2,'Corner mounting has two physical masonry surfaces');
      const contacts=new Set();
      const plates=named(model,'wall-mount-plate');
      assert.equal(plates.length,mode==='corner'?4:2,'Each horizontal console is anchored to the required wall faces');
      for(const plate of plates) {
        const vertices=worldVertices(plate);
        const contact=planes.find(p=>{
          const distances=vertices.map(v=>v.clone().sub(p.point).dot(p.normal));
          return Math.abs(Math.min(...distances))<.01&&Math.abs(Math.max(...distances)-5)<.01;
        });
        assert.ok(contact,'The 5 mm steel plate must sit flush against a wall rather than float in the scene');
        contacts.add(contact.id);
        const backVertices=vertices.filter(v=>Math.abs(v.clone().sub(contact.point).dot(contact.normal))<.01);
        const center=backVertices.reduce((sum,v)=>sum.add(v),new THREE.Vector3()).divideScalar(backVertices.length);
        if(mode==='corner-front')close(center.x,-180,'The front-wall brackets stand 180 mm from the building edge');
        if(mode==='corner-side')close(center.z,-180,'The side-wall brackets stand 180 mm from the building edge');
        const hit=new THREE.Raycaster(center.clone().addScaledVector(contact.normal,1000),contact.normal.clone().negate()).intersectObjects(walls,false)[0];
        assert.ok(hit,'The plate contact point must lie on visible masonry');
        close(hit.distance,1000,'The mounting plate contacts the actual wall geometry');
      }
      assert.deepEqual([...contacts].sort(),contactedWalls(mode));
      for(const point of [pose.arms[0].start,pose.arms[0].end,[0,0,depth/2]]) {
        const expected=new THREE.Vector3(...point).applyMatrix4(model.matrixWorld);
        const shared=new THREE.Vector3(...mount.panelMountPoint(pose,point));
        close(shared.distanceTo(expected),0,'The shared 2D projection uses the same physical mounting coordinates');
      }
      scene.disposeSignObject(assembly);
    }
});

test('The flat mounting plan shows the same exterior wall faces and keeps plates outside masonry',()=>{
  const inside=(point,polygon)=>{
    let result=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const a=polygon[i],b=polygon[j];
      if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;
    }
    return result;
  };
  const attr=(tag,name)=>tag.match(new RegExp(name+'="([^"]+)"'))?.[1];
  for(const mode of mountingModes)for(const shape of ['circle','square','rounded'])for(const size of [200,500,2000])
    for(const depth of [30,160])for(const gap of [60,400]) {
      const markup=svg.createPanelSvgMarkup({shape,size,depth,wallGap:gap,cornerRadius:300,mountMode:mode,
        faceColor:'#ffffff',sideColor:'#172333',image:'',imageScale:82,imageX:0,imageY:0,showDimensions:true});
      assert.doesNotMatch(markup,/NaN|Infinity|undefined/);
      assert.match(markup,new RegExp('data-panel-mount="'+mode+'"'));
      const plan=markup.match(new RegExp('<g data-panel-plan="'+mode+'">([\\s\\S]*?)</g>'))?.[1];
      assert.ok(plan,'A flat top view explains the physical mounting orientation');
      const polygons=[...plan.matchAll(/<polygon\b[^>]*points="([^"]+)"/g)].map(match=>match[1].split(' ').map(pair=>pair.split(',').map(Number)));
      assert.equal(polygons.length,2,'The top view contains a wall outline and a separate housing outline');
      for(const vertex of polygons[1])assert.ok(!inside(vertex,polygons[0]),'The housing outline cannot enter the top-view wall solid');
      const plates=[...plan.matchAll(/<line\b[^>]*data-mount-plane="([^"]+)"[^>]*>/g)];
      assert.deepEqual(plates.map(match=>match[1]).sort(),contactedWalls(mode));
      for(const [tag] of plates) {
        const center=[(Number(attr(tag,'x1'))+Number(attr(tag,'x2')))/2,(Number(attr(tag,'y1'))+Number(attr(tag,'y2')))/2];
        assert.ok(!inside(center,polygons[0]),'The steel plate lies on the exterior side of the corresponding wall face');
      }
    }
});

test('Facade SVG support endpoints and mounting pose exactly match the 3D construction for every placement',()=>{
  const values=tag=>tag.split(/\s+/).map(Number);
  for(const mode of mountingModes)for(const shape of ['circle','square','rounded'])for(const size of [200,500,2000])
    for(const place of ['windows','shop','canopy','entrance']) {
      const pose=mount.panelMountLayout(size,shape,60,300,160,mode);
      const markup=svg.createPanelSvgMarkup({shape,size,depth:160,wallGap:60,cornerRadius:300,mountMode:mode,
        faceColor:'#ffffff',sideColor:'#172333',image:'',imageScale:82,imageX:0,imageY:0});
      const margin=Math.max(70,size*.14),signBox={x:margin+pose.gap,y:margin,width:size,height:size};
      const composition=facade.createFacadeSvg(place,markup,false,'panel-mount-audit',{palette:'stone',panelMount:pose,signBox});
      assert.doesNotMatch(composition,/NaN|Infinity|undefined/);
      assert.match(composition,new RegExp('data-panel-mount="'+mode+'"'));
      const svgPose=values(composition.match(/data-panel-pose="([^"]+)"/)?.[1]??'');
      const expected=[pose.rotationY,pose.position.x,pose.position.y,pose.position.z];
      assert.equal(svgPose.length,4);
      svgPose.forEach((value,i)=>close(value,expected[i],'The facade SVG retains the physical pose',.001));
      const segments=[...pose.arms,...pose.ties];
      const supports=[...composition.matchAll(/data-panel-support="true" data-world-start="([^"]+)" data-world-end="([^"]+)"/g)];
      assert.equal(supports.length,segments.length,'Every 3D support is represented in the facade drawing');
      supports.forEach((support,index)=>{
        const start=mount.panelMountPoint(pose,segments[index].start),end=mount.panelMountPoint(pose,segments[index].end);
        values(support[1]).forEach((value,i)=>close(value,start[i],'Shared support start',.001));
        values(support[2]).forEach((value,i)=>close(value,end[i],'Shared support end',.001));
      });
      const planes=[...composition.matchAll(/data-mount-plane="([^"]+)"/g)].map(match=>match[1]);
      assert.deepEqual(planes.sort(),contactedWalls(mode).flatMap(wall=>[wall,wall]));
      const visibleFace=mode==='wall'||mode==='corner-front'?'back':'front';
      assert.match(composition,new RegExp('data-panel-face-world="'+visibleFace+'"'),'The logo uses the panel face directed toward the facade-view camera');
      assert.match(composition,/data-panel-housing="true"/);
      assert.doesNotMatch(composition,/sign-mounting-band|sign-band-bottom|canopy-sign-upright/,'Letter-only mounting details cannot be mistaken for the bracket support');
    }
});

test('Выключатель гасит вывеску отдельно от света окон и дневного освещения', () => {
  const group=new THREE.Group();
  const sign=new THREE.MeshStandardMaterial({color:'#ff6600',emissive:'#ff6600'}); sign.userData.maxEmission=1.4;
  const window=new THREE.MeshStandardMaterial({color:'#b2c3d6',emissive:'#ffd39e'}); window.userData.maxEmission=.5; window.userData.facadeEmission=true;
  const tube=new THREE.MeshStandardMaterial({color:'#ff55aa',emissive:'#ff55aa'}); tube.userData.neonEmission=1.8;
  const core=new THREE.MeshBasicMaterial({transparent:true}); core.userData.neonCore=true; core.userData.neonBrightness=.8;
  for(const material of [sign,window,tube,core])group.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material));
  scene.applySignLighting(group,1,false);
  assert.equal(sign.emissiveIntensity,0);assert.equal(tube.emissiveIntensity,0);assert.equal(core.opacity,0);assert.equal(window.emissiveIntensity,.5);
  scene.applySignLighting(group,0,true);
  assert.ok(sign.emissiveIntensity>0);assert.ok(tube.emissiveIntensity>0);assert.ok(core.opacity>0);assert.equal(window.emissiveIntensity,0);
  const config={shape:'circle',size:500,faceColor:'#ffffff',sideColor:'#172333',image:'',imageScale:82,imageX:0,imageY:0,sceneMode:'night',showDimensions:true};
  const on=svg.createPanelSvgMarkup({...config,lightsOn:true}),off=svg.createPanelSvgMarkup({...config,lightsOn:false});
  assert.match(on,/id="panel-face" filter=/);assert.doesNotMatch(off,/id="panel-face" filter=/);assert.match(off,/data-dimensions="true"/);
  scene.disposeSignObject(group);
});
