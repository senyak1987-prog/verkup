import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';
import * as THREE from 'three';
const require=createRequire(import.meta.url);
function load(name,dependencies={}) {
  const source=fs.readFileSync(new URL('../src/lib/'+name+'.ts',import.meta.url),'utf8').replaceAll('import.meta.env.BASE_URL','"/"');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};new Function('exports','require',compiled)(exports,key=>dependencies[key]??require(key));return exports;
}
const fonts=load('neonFonts'),handwriting=load('neonHandwriting');
for(const font of fonts.EXTERNAL_NEON_FONTS)fonts.registerNeonFont(font.id,fs.readFileSync(new URL('../public/neon-fonts/'+font.file,import.meta.url),'utf8'));
const neon=load('neonConstruction',{'./neonFonts':fonts,'./neonHandwriting':handwriting});
const scene=load('neonScene',{three:THREE,'./neonConstruction':neon});
const dispose=model=>model.traverse(child=>{child.geometry?.dispose();for(const material of Array.isArray(child.material)?child.material:child.material?[child.material]:[])material.dispose();});

test('Adaptive cubic sampling retains small loops and does not waste samples on straight stems',()=>{
  const curved=fonts.sampleStrokePath('M0 0C100 100 -100 100 0 0')[0];
  const straight=fonts.sampleStrokePath('M0 0C30 0 70 0 100 0')[0];
  assert.equal(straight.length,2);
  assert.ok(curved.length>40);
  assert.ok(Math.max(...curved.map(p=>p[1]))>=74.9);
  assert.deepEqual(curved[0],curved[curved.length-1]);
});

test('Every font keeps its actual pen lifts, without introducing fragments at any allowed size',()=>{
  for(const font of neon.NEON_FONTS) {
    const text=font.cyrillic?'Город Свет ЖЙЩ0128':'Neon Coffee BQRaxy0128';
    const large=neon.createNeonDesign(text,800,6,font.id);
    for(const diameter of [6,8])for(const height of [120,200,300,800]) {
      let design;try{design=neon.createNeonDesign(text,height,diameter,font.id);}catch(error){const chars=Array.from(text).filter(char=>{try{neon.createNeonDesign(char,height,diameter,font.id);return false;}catch{return true;}});throw new Error(font.id+' '+height+' '+diameter+' '+chars.join('')+': '+error.message);}
      assert.equal(design.paths.length,large.paths.length,font.id+' '+height+' mm: a font stroke must not become microcuts');
      assert.equal(design.cuts.length,design.paths.length);
      for(const cut of design.cuts) {
        assert.equal(cut.cutMm%10,0);
        assert.ok(cut.hiddenTailMm>=-.000001&&cut.hiddenTailMm<10.000001);
      }
      assert.doesNotMatch(neon.neonSvg(design,design.width+80,design.height+80,diameter,'#ff7bbd',true,true),/NaN|undefined|Infinity/);
    }
  }
  for(const font of fonts.EXTERNAL_NEON_FONTS) {
    const data=fonts.getNeonFont(font.id),text='Neon Coffee';
    const sourceCount=Array.from(text).reduce((sum,char)=>sum+(data.glyphs[char]?.paths.length??0),0);
    assert.equal(neon.createNeonDesign(text,120,8,font.id).paths.length,sourceCount,font.id+' retains precisely the source pen lifts');
  }
});

test('Small simple lettering renders at 40 mm, while impossible four-millimeter loops request a larger size',()=>{
  for(const font of ['rounded','soft','slanted','narrow','handwritten','signature']) {
    const design=neon.createNeonDesign('СВЕТ',40,8,font);
    assert.ok(design.paths.length&&design.cuts.every(cut=>cut.cutMm%10===0));
  }
  assert.throws(()=>neon.createNeonDesign('8',40,8,'casual'),/Увеличьте высоту/);
});

test('Three independent rows retain fonts, colors, scaling and millimeter offsets in both previews',()=>{
  const options={lineFonts:['rounded','allure','handwritten'],lineColors:['#ff7777','#77aaff','#bb77ff'],lineScales:[1,.7,1.2],lineOffsets:[{x:70,y:20},{x:-35,y:0},{x:0,y:40}],icon:'heart'};
  const design=neon.createNeonDesign('СВЕТ\nNeon Coffee\nгород',200,8,'soft','center',options);
  assert.equal(design.lines.length,3);
  assert.ok(design.iconBounds&&design.pathLineIndices.includes(-1));
  const required=neon.neonRequiredBacker(design),placement=neon.neonDesignPlacement(design,required.width,required.height);
  for(const line of design.lines) {
    assert.ok(line.x+placement.x>=29.99&&line.y+placement.y>=29.99);
    assert.ok(line.x+placement.x+line.width<=required.width-29.99);
    assert.ok(line.y+placement.y+line.height<=required.height-29.99);
  }
  const svg=neon.neonSvg(design,required.width,required.height,8,'#ffaa55',true,true);
  for(const color of options.lineColors)assert.match(svg,new RegExp('stroke="'+color+'"'));
  const model=scene.createNeonModel({neonText:'СВЕТ\nNeon Coffee\nгород',neonHeight:200,neonDiameter:8,neonFont:'soft',neonLineFonts:options.lineFonts,neonLineColors:options.lineColors,neonLineScales:options.lineScales,neonLineOffsets:options.lineOffsets,neonIcon:'heart'},required.width,required.height);
  const materials=new Set(model.children.filter(child=>child.name==='neon-tube').map(child=>'#'+child.material.color.getHexString()));
  for(const color of options.lineColors)assert.ok(materials.has(color));
  dispose(model);
});

test('Moving a single line moves its final rendering by the exact requested millimeters',()=>{
  const initial=neon.createNeonDesign('СВЕТ',200,8,'soft'),moved=neon.createNeonDesign('СВЕТ',200,8,'soft','center',{lineOffsets:[{x:65,y:-30}]});
  const before=neon.neonDesignPlacement(initial,1500,600),after=neon.neonDesignPlacement(moved,1500,600);
  assert.ok(Math.abs((moved.lines[0].x+after.x)-(initial.lines[0].x+before.x)-65)<.00001);
  assert.ok(Math.abs((moved.lines[0].y+after.y)-(initial.lines[0].y+before.y)+30)<.00001);
});

test('A closed stroke has separate endpoint objects, so normalizing cannot translate its seam twice',()=>{
  const path=neon.roundNeonCorners([[0,20],[20,0],[40,20],[20,40],[0,20]],3);
  assert.deepEqual(path[0],path.at(-1));
  assert.notEqual(path[0],path.at(-1));
  const source=path.at(-1)[0];path[0][0]+=25;
  assert.equal(path.at(-1)[0],source);
  const design=neon.createNeonDesign('О',120,6,'rounded');
  assert.deepEqual(design.paths[0][0],design.paths[0].at(-1));
});

test('Empty leading rows preserve font and color indices instead of silently changing the next row',()=>{
  const design=neon.createNeonDesign('\nCoffee',120,6,'rounded','center',{lineFonts:['rounded','allure'],lineColors:['#ff7777','#77aaff']});
  assert.deepEqual(design.lines.map(line=>line.index),[1]);
  assert.ok(design.pathColors.every(color=>color==='#77aaff'));
  assert.ok(design.pathLineIndices.every(index=>index===1));
});

test('Width stretching recomputes physical cuts without fragmenting font strokes',()=>{
  for(const font of neon.NEON_FONTS)for(const ratio of [.5,1.5]) {
    const text=font.cyrillic?'Город Свет':'Neon Coffee',initial=neon.createNeonDesign(text,120,8,font.id);
    const stretched=neon.createNeonDesign(text,120,8,font.id,'center',{targetWidth:initial.width*ratio});
    assert.equal(stretched.paths.length,initial.paths.length,font.id);
    assert.ok(Math.abs(stretched.width-initial.width*ratio)<10,font.id+' uses the requested width');
    for(const cut of stretched.cuts)assert.equal(cut.cutMm%10,0);
  }
});

test('Visible circular turns retain the physical 3 or 4 mm bend radius',()=>{
  for(const radius of [3,4]) {
    const path=neon.roundNeonCorners([[0,100],[0,0],[100,0]],radius);
    const arc=path.slice(1,-1);
    assert.ok(arc.length>12);
    for(const [x,y] of arc)assert.ok(Math.abs(Math.hypot(x-radius,y-radius)-radius)<.00001);
  }
});

test('All rendered font bends respect their physical minimum radius, including short source chords',()=>{
  for(const font of neon.NEON_FONTS)for(const diameter of [6,8]) {
    for(const char of new Set(Array.from(font.cyrillic?'Город Свет ЖЙЩ0128':'Neon Coffee BQRaxy0128'))) {
    const design=neon.createNeonDesign(char,120,diameter,font.id);
    for(const path of design.paths)for(let index=1;index<path.length-1;index++) {
      const a=path[index-1],b=path[index],c=path[index+1],ab=Math.hypot(b[0]-a[0],b[1]-a[1]),bc=Math.hypot(c[0]-b[0],c[1]-b[1]),ac=Math.hypot(c[0]-a[0],c[1]-a[1]);
      const cross=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
      if(cross<.00001)continue;
      const radius=ab*bc*ac/(2*cross);
      assert.ok(radius>=diameter/2-.02,font.id+' '+char+' '+diameter+' mm: '+radius+' mm visible bend '+JSON.stringify(path.slice(Math.max(0,index-5),index+6)));
    }
    }
  }
});

test('Switching sign power off removes the SVG glow, while keeping silicone visible in day and night',()=>{
  const design=neon.createNeonDesign('СВЕТ',200,8,'soft');
  for(const night of [false,true]) {
    const off=neon.neonSvg(design,1000,350,8,'#ff7bbd',night,true,'rectangle',85,{lightsOn:false});
    const on=neon.neonSvg(design,1000,350,8,'#ff7bbd',night,true,'rectangle',85,{lightsOn:true});
    assert.match(off,/data-lights-on="false"/);
    assert.doesNotMatch(off,/data-neon-glow/);
    assert.match(off,/stroke="#ff7bbd" stroke-width="8"/);
    assert.match(on,/data-neon-glow="true"/);
  }
});

test('Continuous 3D tubing has round caps, smooth normals and matching physical radii with power off',()=>{
  const model=scene.createNeonModel({neonText:'Неон',neonFont:'handwritten',neonHeight:200,neonDiameter:8,lightsOn:false},1100,450);
  const design=neon.createNeonDesign('Неон',200,8,'handwritten');
  const tubes=model.children.filter(child=>child.name==='neon-tube');
  assert.equal(tubes.length,design.paths.length);
  assert.equal(model.children.filter(child=>child.name==='neon-rounded-end').length,design.paths.filter(path=>Math.hypot(path[0][0]-path.at(-1)[0],path[0][1]-path.at(-1)[1])>.001).length*2);
  for(const tube of tubes) {
    assert.equal(tube.geometry.parameters.radius,4);
    assert.equal(tube.material.emissiveIntensity,0);
    const values=tube.geometry.attributes.normal.array;
    assert.ok(Array.from(values).every(Number.isFinite));
  }
  for(const core of model.children.filter(child=>child.name==='neon-light-core'))assert.equal(core.material.opacity,0);
  dispose(model);
});

test('Colored backers and hanging hardware work in the same 2D and 3D API',()=>{
  for(const backerColor of ['clear','white','black'])for(const installMode of ['standoffs','hanging']) {
    const model=scene.createNeonModel({neonText:'СВЕТ',neonFont:'soft',neonHeight:200,neonBackerColor:backerColor,neonInstallMode:installMode},1000,350);
    const backer=model.getObjectByName('transparent-acrylic-backer');
    assert.equal(backer.material.transparent,backerColor==='clear');
    assert.equal(model.children.filter(child=>child.name==='neon-standoff-20mm').length,installMode==='standoffs'?4:0);
    assert.equal(model.children.filter(child=>child.name==='neon-hanging-cable').length,installMode==='hanging'?2:0);
    const design=neon.createNeonDesign('СВЕТ',200,6,'soft');
    assert.doesNotMatch(neon.neonSvg(design,1000,350,6,'#ff7bbd',false,true,'rectangle',85,{backerColor,installMode}),/NaN|undefined|Infinity/);
    dispose(model);
  }
});
