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
const sizing=load('neonSizing',{'./neonConstruction':neon});
const scene=load('neonScene',{three:THREE,'./neonConstruction':neon});
const dispose=model=>model.traverse(child=>{child.geometry?.dispose();for(const material of Array.isArray(child.material)?child.material:child.material?[child.material]:[])material.dispose();});

function curveStats(paths,diameter) {
  let maxChord=0,totalTurn=0,tightTurn=0,minRadius=Infinity;
  for(const path of paths) {
    for(let index=1;index<path.length;index++)maxChord=Math.max(maxChord,Math.hypot(path[index][0]-path[index-1][0],path[index][1]-path[index-1][1]));
    for(let index=1;index<path.length-1;index++) {
      const a=path[index-1],b=path[index],c=path[index+1];
      const ab=Math.hypot(b[0]-a[0],b[1]-a[1]),bc=Math.hypot(c[0]-b[0],c[1]-b[1]),ac=Math.hypot(c[0]-a[0],c[1]-a[1]);
      const cross=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
      if(cross<.00001||!ab||!bc)continue;
      const radius=ab*bc*ac/(2*cross);
      const turn=Math.acos(Math.max(-1,Math.min(1,((b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1]))/(ab*bc))));
      totalTurn+=turn;if(radius<diameter*2)tightTurn+=turn;minRadius=Math.min(minRadius,radius);
    }
  }
  return {maxChord,totalTurn,tightTurnFraction:totalTurn?tightTurn/totalTurn:0,minRadius};
}

test('Adaptive cubic sampling retains small loops and does not waste samples on straight stems',()=>{
  const curved=fonts.sampleStrokePath('M0 0C100 100 -100 100 0 0')[0];
  const straight=fonts.sampleStrokePath('M0 0C30 0 70 0 100 0')[0];
  assert.equal(straight.length,2);
  assert.ok(curved.length>40);
  assert.ok(Math.max(...curved.map(p=>p[1]))>=74.9);
  assert.deepEqual(curved[0],curved[curved.length-1]);
});

test('Script bowls distribute curvature across the stroke, rather than long chords joined by tiny fillets',()=>{
  for(const font of fonts.EXTERNAL_NEON_FONTS.filter(font=>font.group==='Рукописные'))for(const diameter of [6,8]) {
    const height=800,design=neon.createNeonDesign('O',height,diameter,font.id),stats=curveStats(design.paths,diameter);
    assert.ok(stats.totalTurn>Math.PI,font.id+' retains its real bowl');
    assert.ok(stats.maxChord<height*.07,font.id+' has no visible long polygon edge: '+stats.maxChord+' mm');
    // Merely subdividing a polygon does not satisfy this test: its directional
    // change remains concentrated in a series of minimum-radius corner arcs.
    assert.ok(stats.tightTurnFraction<.15,font.id+' distributes curvature instead of hiding polygon corners: '+stats.tightTurnFraction);
    assert.ok(stats.minRadius>=diameter/2-.02,font.id+' respects the physical tubing radius');
  }
});

test('Allure LOVE preserves its original pen lifts and endpoints while rendering smooth at both scales',()=>{
  const source=fs.readFileSync(new URL('../public/neon-fonts/EMSAllure.svg',import.meta.url),'utf8'),data=fonts.getNeonFont('allure');
  let expected=0;
  for(const char of 'LOVE') {
    const tag=source.match(new RegExp('<glyph\\b[^>]*unicode="'+char+'"[^>]*>'))?.[0],definition=tag?.match(/d="([^"]*)"/)?.[1];
    assert.ok(definition,char+' exists in the original font source');
    const original=fonts.sampleStrokePath(definition);
    expected+=original.length;
    assert.equal(data.glyphs[char].paths.length,original.length,char+' keeps every genuine pen lift');
    original.forEach((path,index)=>{
      assert.deepEqual(data.glyphs[char].paths[index][0],path[0],char+' keeps its start');
      assert.deepEqual(data.glyphs[char].paths[index].at(-1),path.at(-1),char+' keeps its end');
    });
  }
  for(const height of [120,800])for(const diameter of [6,8]) {
    const design=neon.createNeonDesign('LOVE',height,diameter,'allure');
    assert.equal(design.paths.length,expected,'smoothing does not replace or split the selected font');
    assert.ok(design.paths.every(path=>path.flat().every(Number.isFinite)));
    assert.ok(design.cuts.every(cut=>cut.cutMm>0&&cut.cutMm%10===0));
    const originalBowl=neon.createNeonDesign('O',height,diameter,'allure'),bowl=curveStats(originalBowl.paths,diameter);
    assert.ok(bowl.maxChord<height*.06,'Allure O has no large straight polygon edge at '+height+' mm');
    assert.ok(bowl.tightTurnFraction<.15,'Allure O has continuous curvature at '+height+' mm');
    if(height===800)for(const ratio of [.5,1.5]) {
      const stretched=neon.createNeonDesign('O',height,diameter,'allure','center',{targetWidth:originalBowl.width*ratio}),stats=curveStats(stretched.paths,diameter);
      assert.equal(stretched.paths.length,originalBowl.paths.length);
      assert.ok(stats.maxChord<height*.06,'width stretching retains the curve rather than rebuilding a polygon');
      assert.ok(stats.tightTurnFraction<.15,'width stretching does not concentrate curvature in tiny corners');
      assert.ok(stats.minRadius>=diameter/2-.02,'a stretched bowl still has fabricable bends');
    }
  }
});

test('Angular modern lettering keeps deliberate straight stems and its original endpoint direction',()=>{
  const height=800,diameter=8,data=fonts.getNeonFont('tech'),source=data.glyphs.V.paths[0];
  const design=neon.createNeonDesign('V',height,diameter,'tech'),path=design.paths[0],stats=curveStats(design.paths,diameter);
  assert.equal(design.paths.length,data.glyphs.V.paths.length);
  assert.ok(stats.maxChord>height*.65,'the two straight arms of the modern V do not become script swashes');
  assert.ok(Math.abs((path.at(-1)[0]-path[0][0])-(source.at(-1)[0]-source[0][0])*height/data.capHeight)<.00001);
  assert.ok(Math.abs((path.at(-1)[1]-path[0][1])+(source.at(-1)[1]-source[0][1])*height/data.capHeight)<.00001);
  assert.ok(stats.minRadius>=diameter/2-.02,'the deliberate vertex is still a fabricable bend');
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
  assert.throws(()=>neon.createNeonDesign('О',4,8,'rounded'),/Увеличьте высоту/);
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

test('Letter and line spacing move complete strokes by millimeters without changing tubing length',()=>{
  const initial=neon.createNeonDesign('ОО',200,8,'rounded');
  const spaced=neon.createNeonDesign('ОО',200,8,'rounded','center',{letterSpacing:75});
  assert.equal(spaced.paths.length,initial.paths.length);
  assert.ok(Math.abs(spaced.width-initial.width-75)<.00001);
  for(let index=0;index<spaced.cuts.length;index++){assert.equal(spaced.cuts[index].cutMm,initial.cuts[index].cutMm);assert.ok(Math.abs(spaced.cuts[index].visibleMm-initial.cuts[index].visibleMm)<.000001);}
  const before=neon.createNeonDesign('О\nО',200,8,'rounded');
  const after=neon.createNeonDesign('О\nО',200,8,'rounded','center',{lineSpacing:125});
  assert.ok(Math.abs(after.lines[1].y-before.lines[1].y-125)<.00001);
  for(let index=0;index<after.cuts.length;index++){assert.equal(after.cuts[index].cutMm,before.cuts[index].cutMm);assert.ok(Math.abs(after.cuts[index].visibleMm-before.cuts[index].visibleMm)<.000001);}
  const model=scene.createNeonModel({neonText:'О\nО',neonFont:'rounded',neonHeight:200,neonDiameter:8,neonLineSpacing:125},500,850);
  const tubes=model.children.filter(child=>child.name==='neon-tube');
  const centers=tubes.map(tube=>tube.geometry.parameters.path.getPoint(.5));
  assert.ok(Math.abs(Math.abs(centers[0].y-centers[1].y)-435)<.00001);
  dispose(model);
});

test('Cut-to-shape acrylic follows the concave lettering silhouette and keeps hardware clear of edges',()=>{
  const design=neon.createNeonDesign('О\nООООО',160,8,'rounded');
  const required=neon.neonRequiredBacker(design),placement=neon.neonDesignPlacement(design,required.width,required.height);
  const outline=neon.neonBackerOutline(design,required.width,required.height,'contour');
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
  const signs=outline.map((point,index)=>cross(point,outline[(index+1)%outline.length],outline[(index+2)%outline.length])).filter(value=>Math.abs(value)>.001);
  assert.ok(signs.some(value=>value>0)&&signs.some(value=>value<0),'shorter top row must create a concave outline, rather than a convex diamond');
  const inside=point=>{let result=false;for(let i=0,j=outline.length-1;i<outline.length;j=i++){const a=outline[i],b=outline[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;};
  for(const path of design.paths)for(const [x,y] of path) {
    const px=x+placement.x,py=y+placement.y;
    for(const [dx,dy] of [[0,0],[4,0],[-4,0],[0,4],[0,-4]])assert.ok(inside([px+dx,py+dy]),'the full 8 mm tube remains on the acrylic');
  }
  const holders=neon.neonHolderPositions(outline,required.width,required.height);
  assert.equal(holders.length,4);
  for(const [x,y] of holders)for(let sample=0;sample<16;sample++)assert.ok(inside([x+8*Math.cos(sample*Math.PI/8),y+8*Math.sin(sample*Math.PI/8)]),'mounting caps remain inside the real cut outline');
  const model=scene.createNeonModel({neonText:'О\nООООО',neonFont:'rounded',neonHeight:160,neonDiameter:8,neonBackerShape:'contour'},required.width,required.height);
  const source=model.getObjectByName('transparent-acrylic-backer').geometry.parameters.shapes.getPoints();
  for(const [x,y] of outline)assert.ok(source.some(point=>Math.hypot(point.x-(x-required.width/2),point.y-(required.height/2-y))<.00001),'2D and 3D use the identical cut polygon');
  dispose(model);
});

test('Font availability reports actual characters and handwritten lettering preserves chosen case',()=>{
  for(const font of neon.NEON_FONTS) {
    const text=font.cyrillic?'Кофе №1':'Coffee #1';
    assert.deepEqual(neon.neonUnsupportedCharacters(text,font.id),[]);
    assert.equal(neon.neonFontSupportsText(font.id,text),true);
    assert.deepEqual(neon.neonUnsupportedCharacters('🙂🙂',font.id),['🙂']);
  }
  for(const font of fonts.EXTERNAL_NEON_FONTS)assert.deepEqual(neon.neonUnsupportedCharacters('Coffee №1',font.id),['№']);
  for(const font of ['handwritten','signature']) {
    const upper=neon.createNeonDesign('СВЕТ',200,8,font),lower=neon.createNeonDesign('свет',200,8,font);
    assert.notDeepEqual(upper.paths,lower.paths);
    const cap=neon.createNeonDesign('С',200,8,font),small=neon.createNeonDesign('с',200,8,font);
    assert.ok(cap.lines[0].height>small.lines[0].height+40,'capital letters keep their own tall strokes');
  }
  const regular=neon.createNeonDesign('Neon Coffee',160,6,'allure'),nonbreaking=neon.createNeonDesign('Neon\u00a0Coffee',160,6,'allure');
  assert.deepEqual(nonbreaking.paths,regular.paths);
});

test('The complete native alphabets and advertised symbols render finite, cuttable tube paths',()=>{
  const alphabet='АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const symbols=Object.keys(handwriting.NEON_SYMBOL_GLYPHS).join('');
  for(const font of ['rounded','soft','slanted','narrow','handwritten','signature']) {
    const text=alphabet+alphabet.toLowerCase()+symbols;
    assert.deepEqual(neon.neonUnsupportedCharacters(text,font),[]);
    for(const diameter of [6,8])for(const char of new Set(Array.from(text))) {
      const design=neon.createNeonDesign(char,200,diameter,font);
      assert.ok(design.paths.length&&design.paths.every(path=>path.length>1&&path.flat().every(Number.isFinite)),font+' '+char);
      assert.ok(design.cuts.every(cut=>Number.isFinite(cut.cutMm)&&cut.cutMm>0&&cut.cutMm%10===0),font+' '+char+' cut');
    }
  }
  for(const font of fonts.EXTERNAL_NEON_FONTS) {
    const data=fonts.getNeonFont(font.id);
    for(let code=33;code<=126;code++)assert.ok(data.glyphs[String.fromCharCode(code)]?.paths.some(path=>path.length>1),font.id+' ASCII '+code);
    const capital=neon.createNeonDesign('H',200,6,font.id);
    assert.ok(Math.abs(capital.height-206)<.00001,font.id+' capitals occupy the requested cap height without false padding');
  }
});

test('Tiny external punctuation dots keep their own visible capsules instead of rejecting ordinary words',()=>{
  for(const font of fonts.EXTERNAL_NEON_FONTS)for(const diameter of [6,8])for(const height of [120,200,300]) {
    const text='Light! i j . : ; ? ,',data=fonts.getNeonFont(font.id);
    const expected=Array.from(text).reduce((sum,char)=>sum+(char===' '?0:data.glyphs[char].paths.length),0);
    const design=neon.createNeonDesign(text,height,diameter,font.id);
    assert.equal(design.paths.length,expected,font.id+' retains the real pen lifts and dots');
    assert.ok(design.paths.every(path=>path.length>1&&path.flat().every(Number.isFinite)));
    assert.ok(design.cuts.every(cut=>cut.cutMm>0&&cut.cutMm%10===0));
  }
  const bowl=neon.createNeonDesign('O',120,8,'casual');
  assert.ok(bowl.paths[0].length>20,'a genuine bowl remains a full loop');
  assert.throws(()=>neon.createNeonDesign('О',4,8,'rounded'),/Увеличьте высоту/,'a physically impossible letter loop is not replaced by a dot');
});

test('Width fitting preserves physical spacing and row offsets at integer millimeter letter heights',()=>{
  const options={letterSpacing:30,lineSpacing:50,lineOffsets:[{x:70,y:-20},{x:-30,y:35}]};
  const requested=neon.createNeonDesign('ОО\nООО',221,8,'rounded','center',options).width+2;
  const fitted=sizing.fitNeonToWidth('ОО\nООО',requested,8,'rounded','center',options);
  assert.ok(Number.isInteger(fitted.height)&&fitted.height>=40&&fitted.height<=800);
  assert.ok(Math.abs(fitted.design.width-requested)<4,'one millimeter height steps fit this width within the physical resolution');
  const plain=neon.createNeonDesign('ОО\nООО',fitted.height,8,'rounded','center',{lineOffsets:options.lineOffsets});
  const gap=design=>design.paths[1][0][0]-design.paths[0][0][0];
  assert.ok(Math.abs(gap(fitted.design)-gap(plain)-30)<.00001);
  assert.ok(Math.abs((fitted.design.lines[1].y-fitted.design.lines[0].y)-(plain.lines[1].y-plain.lines[0].y)-50)<.00001);
  const unshifted=neon.createNeonDesign('ОО\nООО',fitted.height,8,'rounded','center',{letterSpacing:30,lineSpacing:50});
  const a=neon.neonDesignPlacement(fitted.design,fitted.backer.width,fitted.backer.height),b=neon.neonDesignPlacement(unshifted,fitted.backer.width,fitted.backer.height);
  for(const line of fitted.design.lines) {
    assert.ok(Math.abs(line.x+a.x-(unshifted.lines[line.index].x+b.x)-options.lineOffsets[line.index].x)<.00001);
    assert.ok(Math.abs(line.y+a.y-(unshifted.lines[line.index].y+b.y)-options.lineOffsets[line.index].y)<.00001);
  }
});

test('Impossible requested widths and missing glyphs report an error rather than a silently different sign',()=>{
  assert.throws(()=>sizing.fitNeonToWidth('ООО',20,8,'rounded','center',{letterSpacing:30}),/ширин.*не меньше/);
  assert.throws(()=>sizing.fitNeonToWidth('О',3800,8,'rounded'),/ширин|больше|высот/);
  assert.throws(()=>sizing.fitNeonToWidth('Coffee 🙂',800,8,'allure'),/не содержит/);
});

test('Suggested sizes depend on the actual text and every offered backer encloses a fabricable design',()=>{
  const options={letterSpacing:30,lineSpacing:50,lineOffsets:[{x:45,y:15},{x:-20,y:30}]};
  for(const [text,font] of [['Город\nСвет','handwritten'],['Coffee!','league'],['СВЕТ','rounded']])for(const diameter of [6,8]) {
    const presets=sizing.suggestNeonSizes(text,diameter,font,'center',options);
    assert.ok(presets.length>0&&presets.length<=3,text+' has usable size choices');
    for(const preset of presets) {
      const design=neon.createNeonDesign(text,preset.height,diameter,font,'center',options),placement=neon.neonDesignPlacement(design,preset.backerWidth,preset.backerHeight);
      assert.ok(Math.abs(design.width-preset.width)<.00001);
      assert.ok(preset.backerWidth<=3950&&preset.backerHeight<=1450);
      assert.ok(design.paths.length&&design.cuts.every(cut=>cut.cutMm>0&&cut.cutMm%10===0));
      for(const [x,y] of design.paths.flat())assert.ok(x+placement.x-diameter/2>=29.99&&y+placement.y-diameter/2>=29.99&&x+placement.x+diameter/2<=preset.backerWidth-29.99&&y+placement.y+diameter/2<=preset.backerHeight-29.99);
    }
  }
  const short=sizing.suggestNeonSizes('СВЕТ',8,'rounded'),long=sizing.suggestNeonSizes('ГОРОД СВЕТ',8,'rounded');
  assert.ok(long[0].width>short[0].width*1.5);
  assert.deepEqual(sizing.suggestNeonSizes('🙂',8,'rounded'),[],'unsupported artwork must not become an empty fabricated preset');
  assert.deepEqual(sizing.suggestNeonSizes('',8,'rounded'),[]);
});

test('Visible circular turns retain the physical 3 or 4 mm bend radius even in smooth-curve mode',()=>{
  for(const radius of [3,4])for(const preserveSmooth of [false,true]) {
    const path=neon.roundNeonCorners([[0,100],[0,0],[100,0]],radius,preserveSmooth);
    assert.ok(!path.some(([x,y])=>Math.hypot(x,y)<.00001),'a sparse right angle is not mistaken for a broad smooth curve');
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
