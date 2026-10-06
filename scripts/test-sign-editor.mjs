import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import opentype from 'opentype.js';
import { createRequire } from 'node:module';
import * as THREE from 'three';
const require=createRequire(import.meta.url);
function load(name, dependencies={}) {
  const source=fs.readFileSync(new URL('../src/lib/'+name+'.ts',import.meta.url),'utf8').replaceAll('import.meta.env.BASE_URL','"/"');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={}; new Function('exports','require',compiled)(exports,key=>dependencies[key]??require(key)); return exports;
}
const neonFonts=load('neonFonts'),handwriting=load('neonHandwriting');
const backer=load('backerConstraints'), neon=load('neonConstruction',{'./neonFonts':neonFonts,'./neonHandwriting':handwriting}), system=load('systemFontContours');
for(const font of neonFonts.EXTERNAL_NEON_FONTS)neonFonts.registerNeonFont(font.id,fs.readFileSync(new URL('../public/neon-fonts/'+font.file,import.meta.url),'utf8'));
const contours=load('letterContours',{'./glyphPath':load('glyphPath'),'./systemFontContours':system});
const construction=load('letterConstruction');
const source=fs.readFileSync(new URL('../src/components/SignProductConfigurator.tsx',import.meta.url),'utf8');
const start=source.indexOf('function createLettersSvgLayout('),end=source.indexOf('\nfunction createLettersSvgMarkup',start);
const compiled=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const layout=new Function('containBox','frameRailCenters','clamp','LETTER_GAP_FACTOR',compiled+';return createLettersSvgLayout;')(backer.containBox,construction.frameRailCenters,(v,min,max)=>Math.max(min,Math.min(max,v)),.16);
const schemaSource=source.slice(source.indexOf('const ORACAL_8500_COLORS'),source.indexOf('type StudioSection'))+
  source.slice(source.indexOf('const DEFAULT_PROJECT'),source.indexOf('type ProjectState'))+
  source.slice(source.indexOf('const PROJECT_ENUMS'),source.indexOf('function loadSavedProject'));
const schemaCompiled=ts.transpileModule(schemaSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const schema=new Function('LETTER_FONTS','resolveSignFont','normalizeLetterDepth','constrainBacker','NEON_FONTS',schemaCompiled+';return {defaults:DEFAULT_PROJECT,validate:validateProject};')(contours.SIGN_FONTS,contours.resolveSignFont,construction.normalizeLetterDepth,backer.constrainBacker,neon.NEON_FONTS);

test('Saved neon and editor projects restore safely, while old projects receive compatible defaults',()=>{
  const old=schema.validate({version:1,project:{lettersText:'ЦВЕТЫ',letterFont:'Montserrat, sans-serif'}});
  assert.equal(old.secondLineText,''); assert.equal(old.logoOffsetX,0); assert.equal(old.neonDiameter,6);
  const imported=schema.validate({version:1,project:{productId:'neon',neonText:'СВЕТ\nКОФЕ\nEXTRA\nHIDDEN',neonDiameter:8,neonFont:'slanted',neonColor:'#ad459f',acpDepth:100,acpWidth:20000,acpHeight:10000,logoOffsetX:75,lightsOn:false,neonLineFonts:['rounded','soft','slanted'],neonLineColors:['#ff0044','#00bbcc','#ffd966'],neonLineOffsets:[{x:15,y:-30}],neonLineScales:[.7,1.5]}});
  assert.equal(imported.neonText,'СВЕТ\nКОФЕ\nEXTRA'); assert.equal(imported.neonDiameter,8); assert.equal(imported.logoOffsetX,75);
  assert.equal(old.lightsOn,true); assert.equal(old.facadePalette,'stone'); assert.equal(imported.lightsOn,false); assert.deepEqual(imported.neonLineOffsets,[{x:15,y:-30}]); assert.deepEqual(imported.neonLineScales,[.7,1.5]);
  assert.equal(imported.acpWidth,3750); assert.equal(imported.acpHeight,1250);
  for(const project of [{neonColor:'url(javascript:alert(1))'},{neonDiameter:7},{neonFont:'missing'},{neonLineFonts:['missing']},{neonLineColors:['url(#x)']},{neonLineOffsets:[{x:NaN,y:0}]},{backdropImage:'https://example.com/img.jpg'}])
    assert.throws(()=>schema.validate({version:1,project}));
});

test('Panel mounting restores a compatible wall default and validates the saved building-corner option',()=>{
  const old=schema.validate({version:1,project:{productId:'panel',panelSize:500}});
  assert.equal(old.panelMountMode,'wall','Existing projects keep the wall installation');
  for(const mode of ['wall','corner','corner-front','corner-side']) {
    const saved=schema.validate({version:1,project:{productId:'panel',panelMountMode:mode,panelSize:500,panelDepth:60,panelWallGap:120}});
    assert.equal(saved.panelMountMode,mode);
    assert.equal(saved.panelSize,500);
    assert.equal(saved.panelDepth,60);
    assert.equal(saved.panelWallGap,120);
  }
  for(const mode of ['parallel','roof','',0,null])
    assert.throws(()=>schema.validate({version:1,project:{productId:'panel',panelMountMode:mode}}),'Unsupported attachment modes must not silently change the mounting geometry');
  const deepCorner=schema.validate({version:1,project:{productId:'panel',panelMountMode:'corner',panelDepth:160,panelWallGap:60}});
  assert.equal(deepCorner.panelWallGap,100,'The restored wall-gap control reports the actual thickness-dependent construction clearance');
  for(const mode of ['corner-front','corner-side']) {
    const orthogonal=schema.validate({version:1,project:{productId:'panel',panelMountMode:mode,panelDepth:160,panelWallGap:60}});
    assert.equal(orthogonal.panelWallGap,60,'Perpendicular corner panels retain the requested gap without diagonal clearance rules');
  }
});

test('ACP fabrication limits include both depths and returns at every supported depth',()=>{
  for(const depth of [30,50,100]) {
    const bounded=backer.constrainBacker(20000,10000,depth);
    assert.equal(bounded.width+2*depth+50,4000); assert.equal(bounded.height+2*depth+50,1500);
    assert.deepEqual(backer.constrainBacker(900,400,depth),{width:900,height:400});
  }
});
test('All embedded fonts: two centered rows and protruding glyphs remain inside the backer after dragging',()=>{
  for(const fontEntry of contours.SIGN_FONTS.filter(item=>item.file)) {
    const bytes=fs.readFileSync(new URL('../public/fonts/'+fontEntry.file,import.meta.url));
    const font=opentype.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const data=contours.combineLetterLines(['ДЦЩЙ','СВЕТ'].map(text=>contours.contoursFromFont(font,text,fontEntry.weight)));
    assert.equal(data.lineFactor,2.35); assert.doesNotMatch(data.pathData,/NaN|Infinity/);
    for(const offset of [-5000,0,5000]) {
      const result=layout({height:550,logoEnabled:true,logoScale:130,logoShape:'circle',mountMode:'acp',letterOutlineEnabled:false,
        text:'ДЦЩЙ\nСВЕТ',contours:data,textBox:data.mainBox,acpLayout:{faceWidth:800,faceHeight:400},widthOverride:0,
        textOffsetX:offset,textOffsetY:offset,logoOffsetX:-offset,logoOffsetY:-offset,frameTopPosition:15,frameBottomPosition:15,frameEdgeInset:0});
      const scale=result.textHeight/data.mainBox.height;
      const ink={x:result.textX,y:result.textBaseline+data.inkBox.y*scale,width:result.textWidth,height:data.inkBox.height*scale};
      for(const box of [ink,result.logoBox]) {
        assert.ok(box.x>=result.panelBox.x-.01 && box.y>=result.panelBox.y-.01,fontEntry.label);
        assert.ok(box.x+box.width<=result.panelBox.x+800+.01 && box.y+box.height<=result.panelBox.y+400+.01,fontEntry.label);
      }
    }
  }
});
test('Arial Black is resolved exactly instead of being mistaken for Arial',()=>{
  assert.equal(contours.resolveSignFont('"Arial Black", sans-serif').weight,900);
  assert.equal(contours.resolveSignFont('Arial, sans-serif').weight,700);
});
test('Raster outline tracing preserves the hole and opposite contour winding',()=>{
  const width=7,height=7,data=new Uint8ClampedArray(width*height*4);
  for(let y=1;y<6;y++)for(let x=1;x<6;x++) if(!(x>=2&&x<=4&&y>=2&&y<=4))data[(y*width+x)*4+3]=255;
  const path=system.traceAlpha(data,width,height); assert.equal((path.match(/M/g)||[]).length,2);
  const signed=path.split('M').slice(1).map(piece=>{
    const points=piece.replace(/Z/g,'').split('L').map(pair=>pair.split(' ').map(Number));
    return points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-p[1]*q[0];},0);
  });
  assert.ok(signed[0]*signed[1]<0);
});
test('All neon alphabets and styles produce contained centerlines and 1 cm cuts',()=>{
  for(const font of neon.NEON_FONTS) for(const diameter of [6,8]) for(const text of (font.cyrillic?['АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ','абвгдеёжзийклмнопрстуфхцчшщъыьэюя','ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789','abcdefghijklmnopqrstuvwxyz','Город\nСВЕТ']:['Neon Coffee','ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789','abcdefghijklmnopqrstuvwxyz'])) {
    let design;try {design=neon.createNeonDesign(text,300,diameter,font.id);} catch(error){throw new Error(font.id+" "+diameter+" "+text+": "+error.message);}
    assert.equal(design.radius,diameter/2);
    for(const cut of design.cuts){assert.equal(cut.cutMm%10,0);assert.ok(cut.cutMm>=cut.visibleMm-.001);assert.ok(cut.hiddenTailMm<10.001);}
    for(const [x,y] of design.paths.flat()){assert.ok(x>=diameter/2-.01 && y>=diameter/2-.01); assert.ok(x<=design.width-diameter/2+.01 && y<=design.height-diameter/2+.01);}
    assert.doesNotMatch(neon.neonSvg(design,design.width+60,design.height+60,diameter,'#ff9955',true,true),/NaN|Infinity|undefined/);
  }
});
test('A right angle bend has the actual 3 or 4 mm circular radius',()=>{
  for(const radius of [3,4]) {
    const points=neon.roundNeonCorners([[0,100],[0,0],[100,0]],radius);
    for(const point of points.slice(1,-1)) assert.ok(Math.abs(Math.hypot(point[0]-radius,point[1]-radius)-radius)<.001);
  }
});
test('Neon 3D has four 20 mm standoffs, a 3 mm transparent backer, and physical tube radii',()=>{
  const scene=load('neonScene',{three:THREE,'./neonConstruction':neon});
  for(const diameter of [6,8]) {
    const model=scene.createNeonModel({neonText:'СВЕТ',neonHeight:200,neonDiameter:diameter,neonFont:'rounded'},1000,350);
    assert.equal(model.children.filter(child=>child.name==='neon-standoff-20mm').length,4);
    const plate=model.getObjectByName('transparent-acrylic-backer'); plate.geometry.computeBoundingBox(); assert.equal(plate.geometry.boundingBox.max.z-plate.geometry.boundingBox.min.z,3); assert.ok(plate.material.transparent);
    for(const tube of model.children.filter(child=>child.name==='neon-tube')) assert.equal(tube.geometry.parameters.radius,diameter/2);
    model.traverse(child=>{child.geometry?.dispose();if(child.material)for(const m of Array.isArray(child.material)?child.material:[child.material])m.dispose();});
  }
});

test('Every neon font supports its stated alphabet at the allowed size extremes without silent substitution',()=>{
  for(const font of neon.NEON_FONTS)for(const diameter of [6,8])for(const height of [120,800]) {
    const design=neon.createNeonDesign(font.cyrillic?'Город Свет':'Neon Coffee',height,diameter,font.id);
    assert.ok(design.paths.length && design.cuts.every(c=>Number.isFinite(c.cutMm)&&c.cutMm%10===0),font.id);
    if(!font.cyrillic)assert.throws(()=>neon.createNeonDesign('Свет',height,diameter,font.id),/не содержит/);
  }
});
test('All transparent backer shapes enclose the tubing and place holders inside the same outline used in 3D',()=>{
  const inside=(p,polygon)=>{let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;};
  for(const font of neon.NEON_FONTS) {
    const design=neon.createNeonDesign(font.cyrillic?'Город\nСвет':'Neon\nCoffee',200,8,font.id),w=design.width+60,h=design.height+60;
    for(const shape of ['rectangle','rounded','contour']) {
      const outline=neon.neonBackerOutline(design,w,h,shape);
      for(const [x,y] of design.paths.flat()) assert.ok(inside([x+30,y+30],outline),font.id+' '+shape);
      for(const p of neon.neonHolderPositions(outline,w,h))assert.ok(inside(p,outline),font.id+' holder '+shape);
    }
  }
});
test('The same four facade compositions render in 2D and as a separate rotatable 3D assembly',()=>{
  const panelMount=load('panelConstruction'),facade=load('signFacade',{'./panelConstruction':panelMount}),threeFacade=load('signFacade3D',{three:THREE,'./signFacade':facade,'./panelConstruction':panelMount});
  assert.equal(threeFacade.createFacadeModel('none',1000,300).children.length,0);
  for(const place of facade.SIGN_PLACEMENTS.filter(p=>p.id!=='none')) {
    const svg=facade.createFacadeSvg(place.id,'<svg viewBox="0 0 100 100"><path id="face" d="M0 0H100"/></svg>',true);
    assert.match(svg,/main-facade-face/);assert.doesNotMatch(svg,/NaN|undefined|Infinity/);
    const model=threeFacade.createFacadeModel(place.id,1000,300);
    assert.equal(model.children.length,facade.facadeRects(place.id,false).length);
    assert.ok(model.getObjectByName('facade-wall').receiveShadow);
    model.traverse(child=>{child.geometry?.dispose();child.material?.dispose();});
  }
});
