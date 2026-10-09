import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createCanvas, Path2D } from '@napi-rs/canvas';
const require=createRequire(import.meta.url);
function load(name,dependencies={}){
  const source=fs.readFileSync(new URL('../src/lib/'+name+'.ts',import.meta.url),'utf8').replaceAll('import.meta.env.BASE_URL','"/"');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const result={};new Function('exports','require',compiled)(result,id=>dependencies[id]??require(id));return result;
}
const frame=load('letterFrame'),backer=load('backerConstraints');
const {createLetterRowsLayout:layout}=load('letterRowsLayout',{'./letterFrame':frame,'./backerConstraints':backer,'./vectorArtwork':load('vectorArtwork')});
const alignment=load('signLayoutAlignment');
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<.001,`${label}: ${a} vs ${b}`);
const rect=(x,y,w,h)=>`M${x} ${y}L${x+w} ${y}L${x+w} ${y+h}L${x} ${y+h}Z`;
function artwork(patch={}){return{id:'import-a',name:'Эмблема',pathData:rect(10,20,100,80)+'M30 40L30 80L70 80L70 40Z',box:{x:10,y:20,width:100,height:80},color:'#336699',height:80,offset:{x:0,y:0},visible:true,...patch};}
function fixture(patch={}){return{height:210,lineSettings:[],logoEnabled:false,logoScale:90,logoShape:'circle',letterOutlineEnabled:false,mountMode:'frame',
  acpLayout:{faceWidth:2000,faceHeight:900},frameTopPosition:15,frameBottomPosition:15,...patch};}
const ordinary={index:0,text:'А',font:'test',height:210,offset:{x:0,y:0}};
const contour={pathData:rect(0,0,100,100),mainBox:{x:0,y:0,width:100,height:100},inkBox:{x:0,y:0,width:100,height:100}};
function pair(){return[artwork(),artwork({id:'import-b',name:'Деталь',pathData:rect(130,50,20,10),box:{x:130,y:50,width:20,height:10},height:10,color:'#ff6600'})];}

test('Without imported artwork, optional integration leaves existing row layout exactly unchanged',()=>{
  const config=fixture({lineSettings:[ordinary],contours:contour,logoEnabled:true});
  assert.deepEqual(layout(config),layout({...config,vectorArtwork:[]}));
  assert.equal(layout(config).letterLineOffsets.length,3);
});
test('Imported paths keep source geometry, holes, colors and relative physical anchors',()=>{
  const objects=pair(),result=layout(fixture({vectorArtwork:objects}));
  assert.equal(result.textRows.length,2);
  const [a,b]=result.textRows;
  assert.equal(a.id,'line-3');assert.equal(b.id,'line-4');assert.equal(a.kind,'vector');
  assert.equal(a.pathData,objects[0].pathData);assert.deepEqual(a.naturalBox,objects[0].box);assert.equal(a.color,'#336699');
  near(a.box.width,100,'Primary width');near(a.box.height,80,'Primary height');
  near(b.box.x-a.box.x,120,'Source X separation');near(b.box.y-a.box.y,30,'Source Y separation');
  assert.deepEqual(a.pathBox,a.inkBox);assert.equal(result.frameSegments.filter(s=>s.kind==='rail').length,3);
  near(result.signBox.width,140,'Visible physical union width');near(result.signBox.height,80,'Visible physical union height');
});
test('Existing lettering stays above the import while all vector parts retain relative positioning',()=>{
  const result=layout(fixture({lineSettings:[ordinary],contours:contour,vectorArtwork:pair()}));
  const [text,a,b]=result.textRows;
  assert.ok(a.box.y>=text.box.y+text.box.height+70);
  near(b.box.x-a.box.x,120,'Source separation with text');near(b.box.y-a.box.y,30,'Source height with text');
  assert.equal(text.kind,undefined);assert.equal(text.box.height,210);
});
test('An invisible imported part contributes no geometry, dimensions or frame but preserves indexed editing slots',()=>{
  const objects=pair(),result=layout(fixture({vectorArtwork:[{...objects[0],visible:false},objects[1]]}));
  assert.equal(result.textRows.length,1);assert.equal(result.textRows[0].id,'line-4');
  assert.equal(result.letterLineOffsets.length,5);assert.equal(result.signBox.width,20);assert.equal(result.signBox.height,10);
  assert.ok(result.frameSegments.every(segment=>segment.rowIds.includes('line-4')));
});
test('Independent resize preserves other sizes and the source anchors rather than rescaling the imported group',()=>{
  const objects=pair(),before=layout(fixture({vectorArtwork:objects}));
  const after=layout(fixture({vectorArtwork:[{...objects[0],height:160},objects[1]]}));
  near(after.textRows[0].box.width,200,'Selected width');near(after.textRows[0].box.height,160,'Selected height');
  near(after.textRows[1].box.height,before.textRows[1].box.height,'Other part size');
  near(after.textRows[1].box.x-after.textRows[0].box.x,120,'Fixed source anchor X');
  near(after.textRows[1].box.y-after.textRows[0].box.y,30,'Fixed source anchor Y');
});
test('Editor movement uses indexed vector offsets and group translation preserves source gaps',()=>{
  const objects=pair(),before=layout(fixture({vectorArtwork:objects}));
  const moved=alignment.moveLayoutSelection(before,'line-4',false,16,-4).patch;
  assert.equal(moved.letterLineOffsets.length,5);assert.deepEqual(moved.letterLineOffsets[4],{x:16,y:-4});assert.deepEqual(moved.letterLineOffsets[3],{x:0,y:0});
  const translated=layout(fixture({vectorArtwork:objects,textOffsetX:40,textOffsetY:20}));
  near(translated.textRows[1].box.x-translated.textRows[0].box.x,120,'Group X gap');
  near(translated.textRows[1].box.y-translated.textRows[0].box.y,30,'Group Y gap');
});
test('Editor corner resize allows 1 mm vector details and retains the ordinary lettering limit of 100 mm',()=>{
  const result=layout(fixture({lineSettings:[ordinary],contours:contour,vectorArtwork:pair()}));
  const heights=[210,0,0,80,10];
  const vector=alignment.resizeLayoutLine(result,'line-4',210,heights,-1000,0);
  assert.equal(vector.letterLineHeights[4],1);assert.equal(vector.letterLineHeights[0],210);
  const text=alignment.resizeLayoutLine(result,'line-0',210,heights,-1000,0);
  assert.equal(text.letterLineHeights[0],100);assert.equal(text.letterLineHeights[4],10);
});
test('All invisible or malformed imports leave no phantom sign or frame',()=>{
  for(const objects of [[artwork({visible:false})],[artwork({pathData:''})],[artwork({box:{x:0,y:0,width:0,height:10}})]]){
    const result=layout(fixture({vectorArtwork:objects}));assert.equal(result.textRows.length,0);assert.equal(result.frameSegments.length,0);
    assert.ok(Object.values(result.signBox).every(Number.isFinite));
  }
});
test('ACP fitting keeps tiny vector details finite and ordinary letters within their manufacturing minimum',()=>{
  const result=layout(fixture({lineSettings:[ordinary],contours:contour,vectorArtwork:pair(),mountMode:'acp',acpLayout:{faceWidth:400,faceHeight:400}}));
  assert.ok(result.textRows[0].box.height>=100);
  assert.ok(result.textRows.filter(row=>row.kind==='vector').every(row=>row.box.height>=1));
  for(const row of result.textRows)assert.ok(Object.values(row.box).every(Number.isFinite));
});

const svgLoader={SVGLoader:class{parse(svg){const data=/ d="([^"]+)"/.exec(svg)?.[1]??'',path=new THREE.ShapePath();
  for(const [,command,numbers]of data.matchAll(/([MLQCZ])([^MLQCZ]*)/g)){
    const values=numbers.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if(command==='M')path.moveTo(...values);if(command==='L')path.lineTo(...values);
    if(command==='Q')path.quadraticCurveTo(...values);if(command==='C')path.bezierCurveTo(...values);if(command==='Z')path.currentPath.closePath();
  }return{paths:[path]};}}};
const scene=load('signSceneGeometry',{three:THREE,'./letterContours':{},'./glyphShapes':load('glyphShapes',{three:THREE}),'./neonScene':{},'./panelConstruction':load('panelConstruction'),
  'three/examples/jsm/loaders/SVGLoader.js':svgLoader,'three/examples/jsm/geometries/RoundedBoxGeometry.js':{RoundedBoxGeometry}});
test('Imported vectors extrude at the same physical bounds with own face colors and preserved counters',async()=>{
  const result=layout(fixture({vectorArtwork:pair()}));
  const project={productId:'letters',sceneMode:'day',letterHeight:210,letterDepth:50,mountMode:'frame',glowMode:'face',logoEnabled:false,
    letterFaceColor:{value:'#ffffff'},letterSideColor:{value:'#222222'},outlineColor:{value:'#000000'}};
  const model=await scene.buildSignModel(project,result,result.signBox.width,result.signBox.height,50,false);
  const centerX=result.signBox.x+result.signBox.width/2,centerY=result.signBox.y+result.signBox.height/2;
  for(const row of result.textRows){
    const mesh=model.getObjectByName('extruded-letter-row-'+row.index),bounds=new THREE.Box3().setFromObject(mesh);
    assert.ok(mesh);assert.equal(mesh.userData.kind,'vector');assert.equal(mesh.material[0].userData.dayColor.getHexString(),row.color.slice(1));
    near(bounds.min.x+centerX,row.box.x,'3D/SVG left');near(centerY-bounds.max.y,row.box.y,'3D/SVG top');
    near(bounds.max.x-bounds.min.x,row.box.width,'3D/SVG width');near(bounds.max.y-bounds.min.y,row.box.height,'3D/SVG height');
    assert.equal(bounds.min.z,15);assert.equal(bounds.max.z,65);
    if(row.index===3){
      let area=0;const positions=mesh.geometry.getAttribute('position'),indices=mesh.geometry.getIndex();
      for(let i=0;i<indices.count;i+=3){const a=indices.getX(i),b=indices.getX(i+1),c=indices.getX(i+2);
        if([a,b,c].every(j=>Math.abs(positions.getZ(j)-50)<.01))area+=Math.abs((positions.getX(b)-positions.getX(a))*(positions.getY(c)-positions.getY(a))-(positions.getY(b)-positions.getY(a))*(positions.getX(c)-positions.getX(a)))/2;
      }near(area,6400,'Counter remains open rather than filled');
    }
  }
  scene.disposeSignObject(model);
});
const pdf=load('signVectorPdf',{'./neonConstruction':{}});
test('PDF contains editable imported letter vectors and colors without bitmap substitution',()=>{
  const result=layout(fixture({vectorArtwork:[artwork()]}));
  const bytes=pdf.createSignVectorPdf({productId:'letters',lettersText:'',mountMode:'frame',glowMode:'face',haloBackerEnabled:false,logoEnabled:false},result);
  const text=new TextDecoder().decode(bytes);
  assert.match(text,/%PDF-1.7/);assert.doesNotMatch(text,/\/Subtype \/Image|NaN|Infinity/);
  assert.match(text,/0\.2 0\.4 0\.6 rg/);assert.ok((text.match(/\n\d+(?:\.\d+)? \d+(?:\.\d+)? m/g)??[]).length>=2,'Outer path and counter remain independent closed paths');
  assert.ok(text.includes('04110443043a0432044b'),'Named lettering layer');
});

function backedArtwork(){return[
  artwork({id:'plate',name:'Подложка',pathData:rect(0,0,300,200),box:{x:0,y:0,width:300,height:200},height:200,color:'#b2a781',role:'backing'}),
  artwork({id:'letters-a',name:'Буквы 1',pathData:rect(30,25,240,60)+'M80 40L80 70L110 70L110 40Z',box:{x:30,y:25,width:240,height:60},height:60,color:'#ffffff',role:'letter'}),
  artwork({id:'letters-b',name:'Буквы 2',pathData:rect(50,115,200,55),box:{x:50,y:115,width:200,height:55},height:55,color:'#ffcc00',role:'letter'}),
];}
const backedProject={productId:'letters',sceneMode:'day',letterHeight:210,letterDepth:50,mountMode:'frame',glowMode:'face',logoEnabled:false,
  letterFaceColor:{value:'#ffffff'},letterSideColor:{value:'#222222'},outlineColor:{value:'#000000'}};
test('Imported enclosure is a nonluminous 3 mm backing and two enclosed letter rows retain full production bodies',async()=>{
  for(const letterDepth of [40,50,60]){
    const result=layout(fixture({vectorArtwork:backedArtwork()}));
    assert.equal(result.textRows[0].vectorRole,'backing');assert.ok(result.textRows.slice(1).every(row=>row.vectorRole==='letter'));
    const model=await scene.buildSignModel({...backedProject,letterDepth},result,result.signBox.width,result.signBox.height,letterDepth,false);
    const plate=model.getObjectByName('imported-backing-3'),plateBounds=new THREE.Box3().setFromObject(plate);
    assert.ok(plate);near(plateBounds.max.z-plateBounds.min.z,3,'Imported backing thickness');
    assert.equal(plate.material[0].emissiveIntensity,0);assert.equal(plate.material[0].transparent,false);
    assert.equal(plate.material[0].userData.dayColor.getHexString(),'b2a781');assert.ok(plate.castShadow&&plate.receiveShadow);
    assert.equal(model.getObjectByName('extruded-letter-row-3'),undefined,'Backing never becomes a glowing letter body');
    for(const row of result.textRows.slice(1)){
      const letter=model.getObjectByName('extruded-letter-row-'+row.index),bounds=new THREE.Box3().setFromObject(letter);
      near(bounds.max.z-bounds.min.z,letterDepth,'Production letter depth');
      near(bounds.min.z,plateBounds.max.z,'Body mounted on imported plate');
      assert.ok(bounds.max.z>plateBounds.max.z+35,'Cap planes cannot conflict');
      if(row.index===4){
        let area=0;const positions=letter.geometry.getAttribute('position'),indices=letter.geometry.getIndex();
        for(let i=0;i<indices.count;i+=3){const a=indices.getX(i),b=indices.getX(i+1),c=indices.getX(i+2);
          if([a,b,c].every(j=>Math.abs(positions.getZ(j)-letterDepth)<.01))area+=Math.abs((positions.getX(b)-positions.getX(a))*(positions.getY(c)-positions.getY(a))-(positions.getY(b)-positions.getY(a))*(positions.getX(c)-positions.getX(a)))/2;
        }near(area,240*60-30*30,'Imported letter counter stays open');
      }
    }
    scene.disposeSignObject(model);
  }
});
test('Halo letters stand 20 mm from the imported plate and its rectangle contributes no glow mask',async()=>{
  const previousDocument=globalThis.document,previousPath=globalThis.Path2D;
  globalThis.document={createElement:()=>createCanvas(1,1)};globalThis.Path2D=Path2D;
  let model;
  try{
    const result=layout(fixture({vectorArtwork:backedArtwork()}));
    model=await scene.buildSignModel({...backedProject,sceneMode:'night',glowMode:'halo',letterDepth:50,haloLightColor:{value:'#ffaa66'}},result,result.signBox.width,result.signBox.height,50,false);
    const plate=model.getObjectByName('imported-backing-3'),plateBounds=new THREE.Box3().setFromObject(plate);
    assert.equal(plate.material[0].emissiveIntensity,0);
    for(const row of result.textRows.slice(1)){
      const bounds=new THREE.Box3().setFromObject(model.getObjectByName('extruded-letter-row-'+row.index));
      near(bounds.min.z-plateBounds.max.z,20,'Halo air gap');near(bounds.max.z-bounds.min.z,50,'Halo full body');
    }
    const spacers=model.children.filter(child=>child.name==='halo-distance-spacer');assert.ok(spacers.length>=4);
    for(const spacer of spacers){const bounds=new THREE.Box3().setFromObject(spacer);near(bounds.min.z,plateBounds.max.z,'Spacer reaches backing face');near(bounds.max.z-bounds.min.z,20,'Spacer length');}
    const halo=model.getObjectByName('rear-halo-projection');assert.ok(halo);assert.ok(halo.position.z>plateBounds.max.z);
    const canvas=halo.material.map.image,context=canvas.getContext('2d'),padding=backedProject.letterHeight*.25;
    const x=Math.round((padding+5)/(result.signBox.width+padding*2)*canvas.width);
    const y=Math.round((padding+5)/(result.signBox.height+padding*2)*canvas.height);
    assert.equal(context.getImageData(x,y,1,1).data[3],0,'Panel corner must stay unlit in the halo mask');
  }finally{if(model)scene.disposeSignObject(model);globalThis.document=previousDocument;globalThis.Path2D=previousPath;}
});
test('Overlapping PDF backing shapes preserve paint order with separate cap planes',async()=>{
  const objects=backedArtwork();objects.splice(1,0,{...objects[0],id:'plate-print',pathData:rect(1,1,298,198),box:{x:1,y:1,width:298,height:198},height:198,color:'#a89f81'});
  const result=layout(fixture({vectorArtwork:objects}));
  const model=await scene.buildSignModel(backedProject,result,result.signBox.width,result.signBox.height,50,false);
  const plates=model.children.filter(child=>child.userData.vectorRole==='backing');assert.equal(plates.length,2);
  const fronts=plates.map(plate=>new THREE.Box3().setFromObject(plate).max.z);assert.ok(fronts[1]>fronts[0]);
  for(const letter of model.children.filter(child=>child.name.startsWith('extruded-letter-row-'))){const bounds=new THREE.Box3().setFromObject(letter);near(bounds.min.z,fronts[1],'Letter on final backing paint layer');}
  scene.disposeSignObject(model);
});
test('Wall halo aura and depth dimensions follow the actual imported 73 mm construction rather than the native wall offset',async()=>{
  const previousDocument=globalThis.document,previousPath=globalThis.Path2D;
  globalThis.document={createElement:()=>createCanvas(1,1)};globalThis.Path2D=Path2D;
  let model;
  try{
    const result=layout(fixture({vectorArtwork:backedArtwork(),mountMode:'wall'}));
    model=await scene.buildSignModel({...backedProject,mountMode:'wall',sceneMode:'night',glowMode:'faceHalo',haloLightColor:{value:'#ffaa66'}},result,result.signBox.width,result.signBox.height,50,true);
    const plateBounds=new THREE.Box3().setFromObject(model.getObjectByName('imported-backing-3'));
    const letterBounds=new THREE.Box3().setFromObject(model.getObjectByName('extruded-letter-row-4'));
    near(plateBounds.min.z,0,'Wall backing rear');near(letterBounds.min.z,23,'3 mm backing plus 20 mm gap');near(letterBounds.max.z,73,'Actual letter front');
    near(model.getObjectByName('face-light-aura').position.z,73.75,'Aura sits just ahead of actual caps');
    const dimensions=model.getObjectByName('dimensions').children.filter(child=>child.isLineSegments);
    for(const line of dimensions.slice(0,-1)){const positions=line.geometry.getAttribute('position');near(positions.getZ(0),75,'Plan dimensions clear actual caps');near(positions.getZ(1),75,'Plan dimensions clear actual caps');}
    const depth=dimensions.at(-1).geometry.getAttribute('position');near(depth.getZ(0),0,'Depth starts at actual plate rear');near(depth.getZ(1),73,'Depth ends at actual cap front');
  }finally{if(model)scene.disposeSignObject(model);globalThis.document=previousDocument;globalThis.Path2D=previousPath;}
});
test('An imported backing alone measures its actual 3 mm thickness without phantom letter depth or light projections',async()=>{
  const previousDocument=globalThis.document,previousPath=globalThis.Path2D;
  globalThis.document={createElement:()=>createCanvas(1,1)};globalThis.Path2D=Path2D;
  let model;
  try{
    const result=layout(fixture({vectorArtwork:[backedArtwork()[0]],mountMode:'wall'}));
    model=await scene.buildSignModel({...backedProject,mountMode:'wall',sceneMode:'night',glowMode:'faceHalo',haloLightColor:{value:'#ffaa66'}},result,result.signBox.width,result.signBox.height,50,true);
    assert.equal(model.children.filter(child=>child.name.startsWith('extruded-letter')).length,0);
    assert.equal(model.getObjectByName('face-light-aura'),undefined);assert.equal(model.getObjectByName('rear-halo-projection'),undefined);
    const dimensions=model.getObjectByName('dimensions').children.filter(child=>child.isLineSegments);
    const depth=dimensions.at(-1).geometry.getAttribute('position');near(depth.getZ(0),0,'Backing rear');near(depth.getZ(1),3,'Backing front');
    for(const line of dimensions.slice(0,-1)){const positions=line.geometry.getAttribute('position');near(positions.getZ(0),5,'Backing-only annotation plane');}
  }finally{if(model)scene.disposeSignObject(model);globalThis.document=previousDocument;globalThis.Path2D=previousPath;}
});
