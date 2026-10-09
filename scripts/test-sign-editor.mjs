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
const backer=load('backerConstraints'), neon=load('neonConstruction',{'./neonFonts':neonFonts,'./neonHandwriting':handwriting}), system=load('systemFontContours', { './contourCurves': load('contourCurves') });
for(const font of neonFonts.EXTERNAL_NEON_FONTS)neonFonts.registerNeonFont(font.id,fs.readFileSync(new URL('../public/neon-fonts/'+font.file,import.meta.url),'utf8'));
const contours=load('letterContours',{'./glyphPath':load('glyphPath'),'./systemFontContours':system});
const construction=load('letterConstruction');
const alignment=load('signLayoutAlignment');
const selection=load('canvasTextSelection');
test('Pointer selection uses proportional glyph stops and clamps beyond both ends',()=>{
  const stops=[0,.1,.55,.75,1];
  assert.equal(selection.caretAtFraction(stops,.5),2);
  assert.equal(selection.caretAtFraction(stops,.12),1);
  assert.equal(selection.caretAtFraction(stops,-2),0);
  assert.equal(selection.caretAtFraction(stops,3),4);
});
test('Text selection preserves its anchor and direction for forward, reverse and extended ranges',()=>{
  assert.deepEqual(selection.canvasSelectionRange('САЛОН КРАСОТЫ',2,5),{start:2,end:5,direction:'forward'});
  assert.deepEqual(selection.canvasSelectionRange('САЛОН КРАСОТЫ',5,2),{start:2,end:5,direction:'backward'});
  assert.deepEqual(selection.canvasSelectionRange('САЛОН КРАСОТЫ',5,11),{start:5,end:11,direction:'forward'});
  assert.deepEqual(selection.canvasSelectionRange('ТЕКСТ',-20,50),{start:0,end:5,direction:'forward'});
});
test('Double click selects Cyrillic words, spaces or punctuation; triple click selects the entire row',()=>{
  const text='САЛОН  КРАСОТЫ!';
  assert.deepEqual(selection.canvasSelectionRange(text,9,9,'word'),{start:7,end:14,direction:'forward'});
  assert.deepEqual(selection.canvasSelectionRange(text,5,5,'word'),{start:5,end:7,direction:'forward'});
  assert.deepEqual(selection.canvasSelectionRange(text,15,15,'word'),{start:14,end:15,direction:'forward'});
  assert.deepEqual(selection.canvasSelectionRange(text,9,9,'line'),{start:0,end:15,direction:'forward'});
  assert.deepEqual(selection.canvasSelectionRange('',0,0,'word'),{start:0,end:0,direction:'forward'});
});
const source=fs.readFileSync(new URL('../src/components/SignProductConfigurator.tsx',import.meta.url),'utf8');
const start=source.indexOf('function createLettersSvgLayout('),end=source.indexOf('\nfunction createLettersSvgMarkup',start);
const compiled=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const layout=new Function('backerSeams','containBox','frameRailCenters','clamp','LETTER_GAP_FACTOR',compiled+';return createLettersSvgLayout;')(backer.backerSeams,backer.containBox,construction.frameRailCenters,(v,min,max)=>Math.max(min,Math.min(max,v)),.16);
const schemaSource=source.slice(source.indexOf('const ORACAL_8500_COLORS'),source.indexOf('type StudioSection'))+
  source.slice(source.indexOf('const DEFAULT_PROJECT'),source.indexOf('type ProjectState'))+
  source.slice(source.indexOf('const PROJECT_ENUMS'),source.indexOf('function loadSavedProject'));
const schemaCompiled=ts.transpileModule(schemaSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const panel=load('panelConstruction');
const schema=new Function('LETTER_FONTS','resolveSignFont','normalizeLetterDepth','constrainBacker','NEON_FONTS','normalizePanelSize','normalizePanelDepth',
  'PANEL_CORNER_RADIUS_MIN','PANEL_CORNER_RADIUS_STEP','panelCornerRadiusLimit','normalizePanelCornerRadius','validateVectorArtwork',
  schemaCompiled+';return {defaults:DEFAULT_PROJECT,validate:validateProject};')(contours.SIGN_FONTS,contours.resolveSignFont,construction.normalizeLetterDepth,backer.constrainBacker,neon.NEON_FONTS,panel.normalizePanelSize,panel.normalizePanelDepth,
  panel.PANEL_CORNER_RADIUS_MIN,panel.PANEL_CORNER_RADIUS_STEP,panel.panelCornerRadiusLimit,panel.normalizePanelCornerRadius,load('vectorArtwork').validateVectorArtwork);

const artworkSource=source.slice(source.indexOf('function resetProjectSettings('),source.indexOf('function EmptySignPreview('));
const artworkCompiled=ts.transpileModule(artworkSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const artwork=new Function('DEFAULT_PROJECT',artworkCompiled+';return {reset:resetProjectSettings,clear:clearProjectArtwork,isBlank:isProjectBlank,createText:createEmptyTextPatch};')(schema.defaults);

test('Reset clears artwork for every product and keeps empty projects empty after saving and reopening',()=>{
  const reset=artwork.reset(),nextReset=artwork.reset();
  for(const key of ['lettersText','secondLineText','thirdLineText','neonText','panelImage','logoImage','backdropImage','neonReferenceImage'])assert.equal(reset[key],'',key);
  assert.equal(reset.logoEnabled,false);assert.equal(reset.neonIcon,'none');
  for(const [key,value] of Object.entries(schema.defaults)){
    if(Array.isArray(value)){
      assert.deepEqual(reset[key],[],'Reset removes saved row settings and vector artwork: '+key);
      assert.notEqual(reset[key],value,'A reset cannot mutate the constructor defaults: '+key);
      assert.notEqual(reset[key],nextReset[key],'Separate resets cannot share row settings: '+key);
    }
  }
  for(const productId of ['letters','neon','panel']){
    const restored=schema.validate(JSON.parse(JSON.stringify({version:1,project:{...reset,productId}})));
    assert.equal(restored.productId,productId);
    assert.equal(restored.panelImage,'','The prepared companion panel cannot reappear after reopening');
    assert.equal(restored.logoEnabled,false);assert.deepEqual(restored.vectorArtwork,[]);
    if(productId!=='panel')assert.equal(artwork.isBlank(restored),true,productId+' remains an empty text draft');
    for(const key of ['letterFont','letterHeight','letterWidth','letterDepth','panelSize','panelDepth','panelCornerRadius','neonFont','neonHeight'])assert.deepEqual(restored[key],schema.defaults[key],key+' returns to its default');
  }
});

test('Creating letters from a locally cleared draft uses default typography and dimensions instead of hidden row overrides',()=>{
  const prior={...schema.defaults,lettersText:'СТАРЫЙ МАКЕТ',secondLineText:'СТРОКА 2',thirdLineText:'СТРОКА 3',
    letterFont:contours.SIGN_FONTS.at(-1).value,letterHeight:231,letterWidth:1800,letterDepth:40,
    letterLineFonts:[contours.SIGN_FONTS.at(-1).value],letterLineHeights:[231,140,170],letterLineOffsets:[{x:300,y:180}],
    textOffsetX:400,textOffsetY:-200,glowMode:'face',mountMode:'wall',letterSideColor:{...schema.defaults.letterSideColor},
    panelImage:'data:image/png;base64,AAAA',logoEnabled:true,logoImage:'data:image/png;base64,AAAA'};
  const cleared=artwork.clear(prior);
  assert.equal(artwork.isBlank(cleared),true);
  assert.equal(cleared.letterHeight,231,'Local clear still retains construction settings until new text is created');
  const next=schema.validate({version:1,project:{...cleared,...artwork.createText('letters','НОВАЯ ВЫВЕСКА')}});
  assert.equal(next.lettersText,'НОВАЯ ВЫВЕСКА');assert.equal(next.secondLineText,'');assert.equal(next.thirdLineText,'');
  for(const key of ['letterFont','letterHeight','letterWidth'])assert.equal(next[key],schema.defaults[key]);
  assert.equal(next.letterDepth,construction.normalizeLetterDepth(schema.defaults.letterHeight,schema.defaults.letterDepth,prior.glowMode));
  for(const key of ['letterLineFonts','letterLineHeights','letterLineOffsets'])assert.deepEqual(next[key],[]);
  assert.equal(next.textOffsetX,0);assert.equal(next.textOffsetY,0);
  assert.equal(next.glowMode,prior.glowMode);assert.equal(next.mountMode,prior.mountMode);assert.deepEqual(next.letterSideColor,prior.letterSideColor);
  assert.equal(next.logoEnabled,false);assert.equal(next.panelImage,'');assert.deepEqual(next.vectorArtwork,[]);
  assert.equal(prior.lettersText,'СТАРЫЙ МАКЕТ','The previous undo snapshot remains intact');
  assert.deepEqual(prior.letterLineHeights,[231,140,170]);
});

test('Creating neon text from a cleared draft resets font, sizes, spacing and per-line overrides without changing its lighting color',()=>{
  const prior={...schema.defaults,productId:'neon',neonText:'СТАРЫЙ\nНЕОН',neonFont:'technical',neonHeight:120,neonDiameter:8,
    neonBackerWidth:2200,neonBackerHeight:800,neonTargetWidth:1700,neonKeepAspect:false,neonLetterSpacing:80,neonLineSpacing:250,
    neonAlign:'right',neonLineFonts:['technical','rounded'],neonLineColors:['#ff0000','#00ff00'],neonLineScales:[.8,1.5],
    neonLineOffsets:[{x:50,y:-70}],neonColor:'#00aaff'};
  const cleared=artwork.clear(prior);assert.equal(artwork.isBlank(cleared),true);
  const next=schema.validate({version:1,project:{...cleared,...artwork.createText('neon','ГОРОД\nСВЕТ')}});
  assert.equal(next.neonText,'ГОРОД\nСВЕТ');assert.equal(artwork.isBlank(next),false);
  for(const key of ['neonFont','neonHeight','neonDiameter','neonBackerWidth','neonBackerHeight','neonTargetWidth','neonKeepAspect','neonLetterSpacing','neonLineSpacing','neonAlign'])assert.equal(next[key],schema.defaults[key],key);
  for(const key of ['neonLineFonts','neonLineColors','neonLineScales','neonLineOffsets'])assert.deepEqual(next[key],[]);
  assert.equal(next.neonColor,prior.neonColor);assert.equal(next.neonIcon,'none');
  assert.equal(prior.neonText,'СТАРЫЙ\nНЕОН');assert.deepEqual(prior.neonLineOffsets,[{x:50,y:-70}]);
});

const svgSource=source.slice(source.indexOf('function createLettersSvgMarkup('),source.indexOf('\nfunction createSvgObjectDimensions'));
const svgCompiled=ts.transpileModule(svgSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const svgMarkup=new Function('roundSvg','escapeXml','hasHaloGlow',svgCompiled+';return createLettersSvgMarkup;')(
  value=>Number(value.toFixed(3)),value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),value=>['halo','faceHalo'].includes(value));
test('Imported rectangular backing paints below lettering and stays outside face and halo lighting in 2D',()=>{
  const box={x:20,y:20,width:120,height:60},ink={x:35,y:30,width:90,height:40};
  const row=(index,vectorRole,color,b)=>({index,vectorRole,kind:'vector',color,font:'',box:b,pathBox:b,naturalBox:b,pathData:`M${b.x} ${b.y}L${b.x+b.width} ${b.y}L${b.x+b.width} ${b.y+b.height}L${b.x} ${b.y+b.height}Z`});
  const config={layout:{textRows:[row(3,'letter','#ffffff',ink),row(4,'backing','#cdc09e',box)],viewWidth:180,viewHeight:100,signBox:box,frameSegments:[],seamXs:[],seamYs:[]},
    height:40,depth:50,faceColor:'#ffffff',sideColor:'#111111',font:'',text:'',glowMode:'faceHalo',mountMode:'frame',acpColor:'#dddddd',
    haloBackerEnabled:false,haloBackerColor:'#ffffff',letterOutlineEnabled:false,logoOutlineEnabled:false,outlineColor:'#000000',logoShape:'circle',logoEnabled:false,logoImage:'',haloLightColor:'#ff0000'};
  for(const sceneMode of ['day','night']){
    const svg=svgMarkup({...config,sceneMode});
    assert.ok(svg.indexOf('data-vector-role="backing"')<svg.indexOf('id="sign-halo"'));
    const face=/<g id="sign-face"[^>]*>(.*?)<\/g><g id="logo-face"/s.exec(svg)[1];
    const halo=/<g id="sign-halo"[^>]*>(.*?)<g id="sign-side"/s.exec(svg)[1];
    assert.match(face,/data-line-index="3"/);assert.doesNotMatch(face,/data-line-index="4"/);
    assert.match(halo,/data-line-index="3"/);assert.doesNotMatch(halo,/data-line-index="4"/);
    assert.equal((svg.match(/data-line-index="4"/g)||[]).length,1,'backing is drawn exactly once');
    if(sceneMode==='day')assert.match(svg,/data-vector-role="backing"[^>]*><path[^>]*fill="#cdc09e"/);
  }
});
test('Импорт ограничивает логотип, отступ контура и дискретные размеры панели',()=>{
  const imported=schema.validate({version:1,project:{logoSizeMm:9000,panelSize:621,panelDepth:80,haloBackerOffsetMm:100}});
  assert.equal(imported.logoSizeMm,700);assert.equal(imported.panelSize,600);assert.equal(imported.panelDepth,130);assert.equal(imported.haloBackerOffsetMm,25);
  const legacy=schema.validate({version:1,project:{letterHeight:400,logoScale:100}});assert.equal(legacy.logoSizeMm,400);
});

test('Saved rounded panels migrate to radii from 50 mm in 10 mm steps and retain their artwork',()=>{
  for(const [radius,expected] of [[0,50],[65,70],[175,170],[300,170]]){
    const saved={productId:'panel',panelShape:'rounded',panelSize:350,panelCornerRadius:radius,
      panelImage:'data:image/png;base64,AAAA',panelImageScale:97,panelImageX:12,panelImageY:-8,lettersText:'СВЕТ'};
    const restored=schema.validate({version:1,project:saved});
    assert.equal(restored.panelCornerRadius,expected);
    for(const key of ['panelImage','panelImageScale','panelImageX','panelImageY','lettersText'])assert.equal(restored[key],saved[key]);
    assert.equal(schema.validate({version:1,project:restored}).panelCornerRadius,expected,'Saving and loading again must not change the migrated radius');
  }
  const large=schema.validate({version:1,project:{productId:'panel',panelShape:'rounded',panelSize:700,panelCornerRadius:300}});
  const smaller=schema.validate({version:1,project:{...large,panelSize:325}});
  assert.equal(smaller.panelSize,350,'The physical size is normalized before the radius limit is calculated');
  assert.equal(smaller.panelCornerRadius,170,'A smaller panel never stores a radius above its half-side or between manufacturing steps');
  const legacy=schema.validate({version:1,project:{productId:'panel',panelShape:'rounded',panelSize:350}});
  assert.equal(legacy.panelCornerRadius,schema.defaults.panelCornerRadius,'Projects without a radius retain a compatible default');
});

test('An imported contour backer selects the supporting frame only in halo modes',()=>{
  for(const glowMode of ['face','faceSide','halo','faceHalo']){
    const imported=schema.validate({version:1,project:{haloBackerEnabled:true,mountMode:'wall',glowMode}});
    assert.equal(imported.mountMode,['halo','faceHalo'].includes(glowMode)?'frame':'wall');
  }
});

const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<.002,message+': '+actual+' / '+expected);
const frameFontBytes=fs.readFileSync(new URL('../public/fonts/Manrope-Variable.ttf',import.meta.url));
const frameFont=opentype.parse(frameFontBytes.buffer.slice(frameFontBytes.byteOffset,frameFontBytes.byteOffset+frameFontBytes.byteLength));
const frameContours=contours.contoursFromFont(frameFont,'ЦВЕТЫ',800);
const frameFixture=(patch={})=>layout({height:300,logoEnabled:true,logoScale:60,logoShape:'circle',mountMode:'frame',
  letterOutlineEnabled:false,text:'ЦВЕТЫ',contours:frameContours,textBox:frameContours.mainBox,
  acpLayout:{faceWidth:2000,faceHeight:400},widthOverride:0,textOffsetX:0,textOffsetY:0,logoOffsetX:0,logoOffsetY:0,
  frameTopPosition:15,frameBottomPosition:15,frameEdgeInset:0,...patch});
const expectFrameMargins=(result,reference,topInset=15,bottomInset=15)=>{
  near(result.railTopY-result.railHeight/2-reference.y,topInset,'Top pipe outer edge follows the smaller object');
  near(reference.y+reference.height-result.railBottomY-result.railHeight/2,bottomInset,'Bottom pipe outer edge follows the smaller object');
  assert.ok(result.railTopY<result.railBottomY,'Both support pipes remain ordered for standard sign dimensions');
};

test('A smaller logo sets both frame margins for every logo silhouette, including its dragged vertical position',()=>{
  for(const logoShape of ['circle','square','rounded'])for(const logoOffsetY of [-65,0,85]) {
    const result=frameFixture({logoShape,logoOffsetY,textOffsetY:-30,frameTopPosition:10,frameBottomPosition:20});
    near(result.logoBox.height,180,'Logo physical height');near(result.textHeight,300,'Letter nominal height');
    expectFrameMargins(result,result.logoBox,10,20);
  }
});

test('Smaller letters set the frame line instead of the larger logo; ties consistently use the lettering',()=>{
  for(const logoScale of [100,130]) {
    const result=frameFixture({logoScale,logoOffsetY:80,textOffsetY:-45});
    expectFrameMargins(result,{y:result.textTop,height:300});
    assert.ok(result.logoBox.y!==result.textTop,'Moving the logo must not move a frame referenced to the letters');
  }
});

test('Hidden logos and protruding Cyrillic glyphs cannot move either frame margin away from the nominal lettering line',()=>{
  for(const entry of contours.SIGN_FONTS.filter(item=>item.file)) {
    const bytes=fs.readFileSync(new URL('../public/fonts/'+entry.file,import.meta.url));
    const font=opentype.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const data=contours.contoursFromFont(font,'ДЦЩЙ',entry.weight);
    const result=frameFixture({logoEnabled:false,logoScale:45,logoOffsetY:900,text:'ДЦЩЙ',contours:data,textBox:data.mainBox});
    assert.ok(result.textInkBox.height>result.textHeight,entry.label+' has real descenders or accents');
    expectFrameMargins(result,{y:result.textTop,height:300});
    near(result.railX,result.textX,'No hidden logo extends the left end');
    near(result.railWidth,result.textWidth,'No hidden logo extends the support length');
  }
});

test('Two text rows form one nominal object, so the shorter logo remains the shared frame reference',()=>{
  const data=contours.combineLetterLines(['ДЦЩЙ','СВЕТ'].map(text=>contours.contoursFromFont(frameFont,text,800)));
  const result=frameFixture({height:200,logoScale:130,text:'ДЦЩЙ\nСВЕТ',contours:data,textBox:data.mainBox,
    logoOffsetY:55,textOffsetY:-35});
  near(result.textHeight,470,'Both 200 mm rows and their interline spacing are included');
  near(result.logoBox.height,260,'Logo stays shorter than the two-row lettering object');
  assert.ok(result.textInkBox.height>result.textHeight,'The row object still distinguishes real Cyrillic ink from its nominal line');
  expectFrameMargins(result,result.logoBox);
});

test('The visible letter outline belongs to the nominal body while accents remain excluded',()=>{
  const data=contours.contoursFromFont(frameFont,'ДЦЩЙ',800),outline=300*.035;
  const result=frameFixture({logoScale:130,letterOutlineEnabled:true,text:'ДЦЩЙ',contours:data,textBox:data.mainBox,
    textOffsetY:55,logoOffsetY:-40});
  near(result.textHeight,300-2*outline,'Contours leave room for the outline');
  expectFrameMargins(result,{y:result.textTop-outline,height:300});
  assert.ok(result.textInkBox.height>result.textHeight,'Actual tails remain distinct from the nominal outlined body');
});

test('Support pipes always span the full placed composition, including separated objects and old saved edge insets',()=>{
  for(const frameEdgeInset of [0,60,120])for(const offset of [-400,0,600]) {
    const result=frameFixture({frameEdgeInset,logoOffsetX:offset,textOffsetX:-offset});
    const left=Math.min(result.logoBox.x,result.textX);
    const right=Math.max(result.logoBox.x+result.logoBox.width,result.textX+result.textWidth);
    near(result.railX,left,'Left support end follows the true composition');
    near(result.railX+result.railWidth,right,'Right support end follows the true composition');
    near(result.railWidth,right-left,'Saved edge-inset values do not shorten the pipes');
  }
});

const alignmentFixture=()=>({viewWidth:2300,viewHeight:550,panelBox:{x:100,y:110,width:2000,height:300},
  defaultTextX:800,defaultTextY:180,defaultLogoX:600,defaultLogoY:160,
  textX:1400,textTop:118,textWidth:500,textHeight:150,textInkBox:{x:1400,y:116,width:500,height:168},
  logoBox:{x:106,y:130,width:200,height:200}});
function applyAlignment(current,patch) {
  const textX=patch.textOffsetX===undefined?current.textX:current.defaultTextX+patch.textOffsetX;
  const textTop=patch.textOffsetY===undefined?current.textTop:current.defaultTextY+patch.textOffsetY;
  return {...current,textX,textTop,textInkBox:{...current.textInkBox,x:current.textInkBox.x+textX-current.textX,y:current.textInkBox.y+textTop-current.textTop},
    logoBox:{...current.logoBox,x:patch.logoOffsetX===undefined?current.logoBox.x:current.defaultLogoX+patch.logoOffsetX,
      y:patch.logoOffsetY===undefined?current.logoBox.y:current.defaultLogoY+patch.logoOffsetY}};
}
test('Object centering uses the actual non-origin 2000 × 300 panel and preserves the other axis and object',()=>{
  for(const selected of ['text','logo'])for(const axis of ['x','y']) {
    const before=alignmentFixture(),patch=alignment.centerLayoutSelection(before,selected,true,axis,true);
    const after=applyAlignment(before,patch),a=alignment.layoutSelectionBox(after,selected,true),b=alignment.layoutSelectionBox(before,selected,true);
    near(axis==='x'?a.x+a.width/2:a.y+a.height/2,axis==='x'?1100:260,'Selected object center');
    near(axis==='x'?a.y:a.x,axis==='x'?b.y:b.x,'Other axis remains in place');
    if(selected==='text')assert.deepEqual(after.logoBox,before.logoBox); else near(after.textX,before.textX,'Text remains in place');
  }
});
test('Composition centering and bounded dragging preserve the full distance between logo and lettering',()=>{
  const before=alignmentFixture();
  let centered=applyAlignment(before,alignment.centerLayoutSelection(before,'composition',true,'x',true));
  centered=applyAlignment(centered,alignment.centerLayoutSelection(centered,'composition',true,'y',true));
  const union=alignment.layoutSelectionBox(centered,'composition',true);
  near(union.x+union.width/2,1100,'Composition X');near(union.y+union.height/2,260,'Composition Y');
  near(centered.textX-centered.logoBox.x,before.textX-before.logoBox.x,'Horizontal spacing');
  near(centered.textTop-centered.logoBox.y,before.textTop-before.logoBox.y,'Vertical spacing');
  const moved=applyAlignment(before,alignment.moveLayoutSelection(before,'composition',true,5000,-5000,{constrainToPanel:true}).patch);
  const movedUnion=alignment.layoutSelectionBox(moved,'composition',true);
  near(movedUnion.x+movedUnion.width,2094,'Right fabrication margin');near(movedUnion.y,116,'Top fabrication margin');
  near(moved.textX-moved.logoBox.x,before.textX-before.logoBox.x,'Bounded horizontal spacing');
  near(moved.textTop-moved.logoBox.y,before.textTop-before.logoBox.y,'Bounded vertical spacing');
});
test('Drag snaps to each panel center only within its threshold; fine keyboard steps remain free',()=>{
  const before=alignmentFixture(),box=alignment.layoutSelectionBox(before,'text',true);
  const target=1100-box.x-box.width/2;
  const snapped=alignment.moveLayoutSelection(before,'text',true,target+5,10,{constrainToPanel:true,snapTolerance:6});
  assert.equal(snapped.snappedX,true);assert.equal(snapped.snappedY,false);
  const centered=applyAlignment(before,snapped.patch);near(centered.textX+box.width/2,1100,'Snapped center');
  const free=alignment.moveLayoutSelection(before,'text',true,target+7,10,{constrainToPanel:true,snapTolerance:6});
  assert.equal(free.snappedX,false);near(applyAlignment(before,free.patch).textX+box.width/2,1107,'Outside snapping threshold');
  const step=alignment.moveLayoutSelection(centered,'text',true,1,0,{constrainToPanel:true});
  near(applyAlignment(centered,step.patch).textX,centered.textX+1,'One millimetre keyboard step');
  assert.equal(alignment.moveLayoutSelection(before,'text',true,target+5,10,{constrainToPanel:true,snapTolerance:0}).snappedX,false);
});
test('Center commands recover clamped saved offsets and center the full real Cyrillic ink after layout recomputation',()=>{
  const bytes=fs.readFileSync(new URL('../public/fonts/Manrope-Variable.ttf',import.meta.url));
  const font=opentype.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const data=contours.combineLetterLines(['ДЦЩЙ','СВЕТ'].map(text=>contours.contoursFromFont(font,text,800)));
  const config={height:110,logoEnabled:true,logoScale:90,logoShape:'circle',mountMode:'acp',letterOutlineEnabled:false,
    text:'ДЦЩЙ\nСВЕТ',contours:data,textBox:data.mainBox,acpLayout:{faceWidth:2000,faceHeight:400},widthOverride:1000,
    textOffsetX:5000,textOffsetY:-5000,logoOffsetX:-5000,logoOffsetY:5000,frameTopPosition:15,frameBottomPosition:15,frameEdgeInset:0};
  const before=layout(config),xPatch=alignment.centerLayoutSelection(before,'text',true,'x',true);
  const horizontal=layout({...config,...xPatch}),yPatch=alignment.centerLayoutSelection(horizontal,'text',true,'y',true);
  const centered=layout({...config,...xPatch,...yPatch});
  near(centered.textInkBox.x+centered.textInkBox.width/2,centered.panelBox.x+1000,'Real ink X');
  near(centered.textInkBox.y+centered.textInkBox.height/2,centered.panelBox.y+200,'Real ink Y');
  assert.deepEqual(centered.logoBox,before.logoBox,'Centering lettering does not move the logo');
  const step=alignment.moveLayoutSelection(before,'text',true,-10,10,{constrainToPanel:true}).patch;
  const dragged=layout({...config,...step});near(dragged.textX,before.textX-10,'Dragging starts from the visible constrained location');
  const packed=layout({...config,...alignment.packLayoutComposition(before,true,true)});
  near(packed.textInkBox.y+packed.textInkBox.height/2,packed.panelBox.y+200,'Packed Cyrillic ink Y');
  near(packed.logoBox.y+packed.logoBox.height/2,packed.panelBox.y+200,'Packed logo Y');
  near(packed.textInkBox.x-packed.logoBox.x-packed.logoBox.width,before.defaultTextX-before.defaultLogoX-before.logoBox.width,'Packed construction gap');
  const packedBox=alignment.layoutSelectionBox(packed,'composition',true);near(packedBox.x+packedBox.width/2,packed.panelBox.x+1000,'Packed real composition X');
  const restored=schema.validate({version:1,project:{logoOffsetX:75.123,textOffsetY:-35.456}});
  assert.equal(restored.logoOffsetX,75.123);assert.equal(restored.textOffsetY,-35.456);
});
test('Composition selection without a logo centers only the lettering and does not invent logo offsets',()=>{
  const before=alignmentFixture(),patch=alignment.centerLayoutSelection(before,'composition',false,'x',true);
  assert.equal(patch.logoOffsetX,undefined);assert.equal(patch.logoOffsetY,undefined);
  const after=applyAlignment(before,patch);near(after.textX+after.textWidth/2,1100,'Lettering center');
  assert.deepEqual(after.logoBox,before.logoBox);
});
test('One-click assembly repairs a separated edge-to-edge composition with the standard gap and centered real ink',()=>{
  const before=alignmentFixture();
  const after=applyAlignment(before,alignment.packLayoutComposition(before,true,true));
  const expectedGap=before.defaultTextX-before.defaultLogoX-before.logoBox.width;
  near(after.textInkBox.x-after.logoBox.x-after.logoBox.width,expectedGap,'Standard row gap');
  near(after.textInkBox.y+after.textInkBox.height/2,260,'Ink vertically centered');
  near(after.logoBox.y+after.logoBox.height/2,260,'Logo vertically centered');
  const union=alignment.layoutSelectionBox(after,'composition',true);near(union.x+union.width/2,1100,'Packed composition centered');
  for(const box of [after.textInkBox,after.logoBox]) {
    assert.ok(box.x>=106 && box.x+box.width<=2094);assert.ok(box.y>=116 && box.y+box.height<=404);
  }
  const onlyText=applyAlignment(before,alignment.packLayoutComposition(before,false,true));
  near(onlyText.textInkBox.x+onlyText.textInkBox.width/2,1100,'No-logo X');near(onlyText.textInkBox.y+onlyText.textInkBox.height/2,260,'No-logo Y');
});

test('Saved neon and editor projects restore safely, while old projects receive compatible defaults',()=>{
  const old=schema.validate({version:1,project:{lettersText:'ЦВЕТЫ',letterFont:'Montserrat, sans-serif'}});
  assert.equal(old.secondLineText,''); assert.equal(old.logoOffsetX,0); assert.equal(old.neonDiameter,6);
  const imported=schema.validate({version:1,project:{productId:'neon',neonText:'СВЕТ\nКОФЕ\nEXTRA\nHIDDEN',neonDiameter:8,neonFont:'slanted',neonColor:'#ad459f',acpDepth:100,acpWidth:20000,acpHeight:10000,logoOffsetX:75,lightsOn:false,neonLineFonts:['rounded','soft','slanted'],neonLineColors:['#ff0044','#00bbcc','#ffd966'],neonLineOffsets:[{x:15,y:-30}],neonLineScales:[.7,1.5]}});
  assert.equal(imported.neonText,'СВЕТ\nКОФЕ\nEXTRA'); assert.equal(imported.neonDiameter,8); assert.equal(imported.logoOffsetX,75);
  assert.equal(old.lightsOn,true); assert.equal(old.facadePalette,'stone'); assert.equal(imported.lightsOn,false); assert.deepEqual(imported.neonLineOffsets,[{x:15,y:-30}]); assert.deepEqual(imported.neonLineScales,[.7,1.5]);
  assert.equal(imported.acpWidth,20000); assert.equal(imported.acpHeight,1250);
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
    assert.equal(saved.panelDepth,130);
    assert.equal(saved.panelWallGap,120);
  }
  for(const mode of ['parallel','roof','',0,null])
    assert.throws(()=>schema.validate({version:1,project:{productId:'panel',panelMountMode:mode}}),'Unsupported attachment modes must not silently change the mounting geometry');
  const deepCorner=schema.validate({version:1,project:{productId:'panel',panelMountMode:'corner',panelDepth:160,panelWallGap:60}});
  assert.equal(deepCorner.panelWallGap,95,'The restored wall-gap control reports the actual thickness-dependent construction clearance');
  for(const mode of ['corner-front','corner-side']) {
    const orthogonal=schema.validate({version:1,project:{productId:'panel',panelMountMode:mode,panelDepth:160,panelWallGap:60}});
    assert.equal(orthogonal.panelWallGap,60,'Perpendicular corner panels retain the requested gap without diagonal clearance rules');
  }
});

test('ACP fabrication limits include both depths and returns at every supported depth',()=>{
  for(const depth of [30,50,100]) {
    const bounded=backer.constrainBacker(20000,10000,depth);
    assert.equal(bounded.width,20000);
    const joins=[0,...backer.backerSeams(bounded.width,depth),bounded.width];
    for(let i=1;i<joins.length;i++)assert.ok(joins[i]-joins[i-1]+2*depth+50<=4000+.001); assert.equal(bounded.height+2*depth+50,1500);
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
        text:'ДЦЩЙ\nСВЕТ',contours:data,textBox:data.mainBox,acpLayout:{faceWidth:12000,faceHeight:1300},widthOverride:0,
        textOffsetX:offset,textOffsetY:offset,logoOffsetX:-offset,logoOffsetY:-offset,frameTopPosition:15,frameBottomPosition:15,frameEdgeInset:0});
      const scale=result.textHeight/data.mainBox.height;
      const ink={x:result.textX,y:result.textBaseline+data.inkBox.y*scale,width:result.textWidth,height:data.inkBox.height*scale};
      for(const box of [ink,result.logoBox]) {
        assert.ok(box.x>=result.panelBox.x-.01 && box.y>=result.panelBox.y-.01,fontEntry.label);
        assert.ok(box.x+box.width<=result.panelBox.x+result.panelBox.width+.01 && box.y+box.height<=result.panelBox.y+result.panelBox.height+.01,fontEntry.label);
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
    assert.ok(model.children.length>facade.facadeRects(place.id,false).length);
    assert.equal(model.userData.closedBuilding,true);
    assert.ok(model.getObjectByName('facade-wall').receiveShadow);
    model.traverse(child=>{child.geometry?.dispose();child.material?.dispose();});
  }
});

test('Imported rows and logos clamp to 100–700 mm, retaining zero as an unused row marker',()=>{
 for(const value of [1,99,100,700,701,900,1200]){
  const p=schema.validate({version:1,project:{letterHeight:value,letterLineHeights:[value,0,value],logoSizeMm:value}});
  const expected=Math.max(100,Math.min(700,value));
  assert.equal(p.letterHeight,expected);assert.equal(p.logoSizeMm,expected);assert.deepEqual(p.letterLineHeights,[expected,0,expected]);
 }
});

function marqueeFixture() {
  const row=(index,x,y,width,height,kind)=>({id:String(index),index,text:kind?'':'ТЕКСТ',font:'Arial',kind,
    defaultX:x-10,defaultY:y-20,box:{x,y,width,height},inkBox:{x,y:y-5,width,height:height+10},pathBox:{x,y,width,height}});
  return {viewWidth:1000,viewHeight:700,panelBox:{x:0,y:0,width:1000,height:700},
    textX:100,textTop:100,textWidth:600,textHeight:400,defaultTextX:90,defaultTextY:80,
    logoBox:{x:750,y:100,width:150,height:150},defaultLogoX:700,defaultLogoY:80,
    textRows:[row(0,100,100,350,100),row(1,100,300,300,100),row(3,550,300,100,160,'vector')],
    letterLineOffsets:[{x:10,y:20},{x:10,y:20},{x:77,y:88},{x:10,y:20}]};
}

test('Marquee crosses rows, logos and imported vectors in all four directions, including visible accents',()=>{
  const fixture=marqueeFixture();
  for(const [start,end] of [[{x:50,y:90},{x:800,y:350}],[{x:800,y:350},{x:50,y:90}],
    [{x:50,y:350},{x:800,y:90}],[{x:800,y:90},{x:50,y:350}]]) {
    assert.deepEqual(alignment.marqueeLayoutSelection(fixture,true,alignment.marqueeBox(start,end)),['line-0','line-1','line-3','logo']);
  }
  assert.deepEqual(alignment.marqueeLayoutSelection(fixture,true,{x:90,y:93,width:30,height:4}),['line-0']);
  assert.deepEqual(alignment.marqueeLayoutSelection(fixture,false,{x:749,y:100,width:10,height:20}),[]);
  assert.deepEqual(alignment.marqueeLayoutSelection(fixture,true,{x:50,y:50,width:0,height:400}),[]);
  assert.deepEqual(alignment.marqueeLayoutSelection(fixture,true,{x:920,y:600,width:50,height:50}),[]);
});

test('A mixed group translates only selected objects and leaves unused row offsets intact',()=>{
  const before=marqueeFixture(),saved=structuredClone(before);
  const {patch}=alignment.moveLayoutSelection(before,['line-1','line-3','logo'],true,25,-15);
  assert.deepEqual(patch.letterLineOffsets,[{x:10,y:20},{x:35,y:5},{x:77,y:88},{x:35,y:5}]);
  assert.equal(patch.logoOffsetX,75);assert.equal(patch.logoOffsetY,5);
  assert.equal(patch.textOffsetX,undefined);assert.equal(patch.textOffsetY,undefined);
  assert.deepEqual(before,saved,'Pointer snapshots and saved offsets are not mutated');
});

test('Group movement clamps once at the panel edge so the distances between members remain unchanged',()=>{
  const fixture=marqueeFixture(),{patch}=alignment.moveLayoutSelection(fixture,['line-0','logo'],true,5000,-5000,{constrainToPanel:true});
  assert.deepEqual(patch.letterLineOffsets[0],{x:104,y:-69});
  assert.equal(patch.logoOffsetX,144);assert.equal(patch.logoOffsetY,-69);
  assert.equal(fixture.defaultLogoX+patch.logoOffsetX-(fixture.textRows[0].defaultX+patch.letterLineOffsets[0].x),650);
  assert.deepEqual(patch.letterLineOffsets[1],fixture.letterLineOffsets[1]);
});

test('Group snap and centering use the selected union, and an empty selection never moves anything',()=>{
  const fixture=marqueeFixture(),ids=['line-1','line-3'];
  assert.deepEqual(alignment.layoutSelectionBox(fixture,ids,true),{x:100,y:295,width:550,height:170});
  const result=alignment.moveLayoutSelection(fixture,ids,true,124,0,{snapTolerance:6});
  assert.equal(result.snappedX,true);assert.equal(result.patch.letterLineOffsets[1].x,135);assert.equal(result.patch.letterLineOffsets[3].x,135);
  assert.deepEqual(alignment.centerLayoutSelection(fixture,ids,true,'x'),result.patch);
  assert.deepEqual(alignment.moveLayoutSelection(fixture,[],true,10,10).patch,{});
  assert.deepEqual(alignment.moveLayoutSelection(fixture,['line-9'],true,10,10).patch,{});
});
